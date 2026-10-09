import { Effect, Fiber, Stream } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";
import { Summary, type AiSettings } from "@/domain/ai";
import { DEFAULT_SETTINGS, type BookMeta, ReaderSettings } from "@/domain/book";
import { runtime, type AppServices } from "@/runtime";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs, type JobState } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";
import type { SummaryInput, SummaryRun } from "@/use-cases/summary";
import { watchBookImage } from "@/use-cases/book-image";
import { renderFigures } from "@/use-cases/render-figures";

type AsyncState<A, E> =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly value: A }
  | { readonly status: "error"; readonly error: E };

export type Job = Fiber.Fiber<unknown, unknown>;

export function runApp<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return runtime.runPromise(effect);
}

export function forkApp(effect: Effect.Effect<unknown, unknown, AppServices>): Job {
  return runtime.runFork(effect);
}

export function stopFiber(fiber: Job): void {
  runtime.runFork(Fiber.interrupt(fiber));
}

// Mounted covers share one read and one object URL for each book image.
const bookImages = new Map<
  string,
  {
    url: string | null;
    ratio: number | null;
    users: Set<(image: { readonly url: string; readonly ratio: number | null } | null) => void>;
    job: Job | null;
  }
>();

export function useFigureJobs(books: ReadonlyArray<BookMeta>, startPage = 1): void {
  const jobs = useRef(new Map<string, Job>());

  useEffect(() => {
    for (const book of books) {
      if (!book.figuresPending || jobs.current.has(book.id)) continue;
      const bookId = book.id;
      const job = renderFigures(bookId, startPage).pipe(
        Effect.ensuring(Effect.sync(() => jobs.current.delete(bookId))),
      );
      jobs.current.set(bookId, forkApp(job));
    }
  }, [books, startPage]);

  useEffect(
    () => () => {
      for (const fiber of jobs.current.values()) stopFiber(fiber);
      jobs.current.clear();
    },
    [],
  );
}

export function useBookImage(
  bookId: string,
  imageId: string,
): { readonly url: string | null; readonly ratio: number | null } {
  const key = `${bookId}/${imageId}`;
  const [image, setImage] = useState<{ url: string; ratio: number | null } | null>(() => {
    const shared = bookImages.get(key);
    return shared?.url === null || shared === undefined
      ? null
      : { url: shared.url, ratio: shared.ratio };
  });

  useEffect(() => {
    const update = (next: { readonly url: string; readonly ratio: number | null } | null): void =>
      setImage(next);
    let shared = bookImages.get(key);
    if (shared === undefined) {
      shared = { url: null, ratio: null, users: new Set(), job: null };
      bookImages.set(key, shared);
    }
    const entry = shared;
    entry.users.add(update);
    if (entry.url !== null) setImage({ url: entry.url, ratio: entry.ratio });
    if (entry.job === null) {
      entry.job = forkApp(
        watchBookImage(bookId, imageId, (record) => {
          if (bookImages.get(key) !== entry) return;
          if (record === null) {
            if (entry.url !== null) URL.revokeObjectURL(entry.url);
            entry.url = null;
            entry.ratio = null;
            for (const user of entry.users) user(null);
            return;
          }
          if (entry.url !== null) URL.revokeObjectURL(entry.url);
          entry.url = URL.createObjectURL(record.blob);
          entry.ratio = record.height === 0 ? null : record.width / record.height;
          for (const user of entry.users) {
            user({ url: entry.url, ratio: entry.ratio });
          }
        }),
      );
    }
    return () => {
      if (bookImages.get(key) !== entry) return;
      entry.users.delete(update);
      // A tile that moves to another row mounts again in the same commit and takes the URL over.
      queueMicrotask(() => {
        if (entry.users.size > 0 || bookImages.get(key) !== entry) return;
        if (entry.job !== null) stopFiber(entry.job);
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
        bookImages.delete(key);
      });
    };
  }, [bookId, imageId]);

  return { url: image?.url ?? null, ratio: image?.ratio ?? null };
}

export function useAppEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  deps: DependencyList,
): { readonly state: AsyncState<A, E>; readonly reload: () => void } {
  const [state, setState] = useState<AsyncState<A, E>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const lastNonce = useRef(nonce);

  useEffect(() => {
    // A reload keeps the current value on screen until the new one arrives; only new deps show loading.
    if (lastNonce.current === nonce) setState({ status: "loading" });
    lastNonce.current = nonce;
    // Interrupting the fiber stops a load that new deps replaced, so it cannot overwrite the newer one.
    const fiber = forkApp(
      Effect.match(effect, {
        onFailure: (error) => setState({ status: "error", error }),
        onSuccess: (value) => setState({ status: "done", value }),
      }),
    );
    return () => stopFiber(fiber);
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { state, reload };
}

// The settings as last read, so a screen that mounts again starts from them and not the defaults.
let lastSettings = DEFAULT_SETTINGS;

export function useSettings(): {
  readonly settings: ReaderSettings;
  readonly update: (patch: Partial<ReaderSettings>) => void;
} {
  const [settings, setSettings] = useState<ReaderSettings>(lastSettings);

  useEffect(() => {
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const store = yield* SettingsStore;
        yield* Stream.runForEach(store.changes(), (next) =>
          Effect.sync(() => {
            lastSettings = next;
            setSettings(next);
          }),
        );
      }),
    );
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  // Before paint, so a page's first frame, and the snapshot a slide takes of it, has its theme.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--temperature", String(settings.temperature));
  }, [settings.theme, settings.temperature]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    const save = Effect.flatMap(SettingsStore, (store) => store.update(patch));
    // The store applies the change before saving, so a failed write only loses it on restart.
    forkApp(save.pipe(Effect.catchTag("StorageFailure", () => Effect.void)));
  }, []);

  return { settings, update };
}

// The AI record: null until it is set, and null again after "Remove key".
export function useAiSettings(): {
  readonly ai: AiSettings | null;
  readonly putAi: (next: AiSettings | null) => void;
} {
  const [ai, setAi] = useState<AiSettings | null>(null);

  useEffect(() => {
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const store = yield* SettingsStore;
        yield* Stream.runForEach(store.aiChanges(), (next) => Effect.sync(() => setAi(next)));
      }),
    );
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  const putAi = useCallback((next: AiSettings | null) => {
    const save = Effect.flatMap(SettingsStore, (store) => store.putAi(next));
    forkApp(save.pipe(Effect.catchTag("StorageFailure", () => Effect.void)));
  }, []);

  return { ai, putAi };
}

// A job's run and error by its key, live, for a job that no single book's Summary shows.
export function useJob(key: string): JobState & {
  readonly startNames: (settings: AiSettings) => void;
  readonly stop: () => void;
} {
  const [job, setJob] = useState<JobState>({ run: null, error: null });
  useEffect(() => {
    const fiber = forkApp(
      Effect.flatMap(SummaryJobs, (jobs) =>
        jobs.state(key).pipe(Stream.runForEach((next) => Effect.sync(() => setJob(next)))),
      ),
    );
    return () => stopFiber(fiber);
  }, [key]);
  const startNames = useCallback((settings: AiSettings) => {
    forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.startNames(settings)));
  }, []);
  const stop = useCallback(() => {
    forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.stop(key)));
  }, [key]);
  return { ...job, startNames, stop };
}

export interface SummaryState {
  readonly summary: Summary | null;
  readonly run: SummaryRun | null;
  readonly error: string | null;
}

// The book's summary and its job, live: the record follows every write, the run follows the job.
export function useSummary(bookId: string): SummaryState & {
  readonly start: (input: SummaryInput, settings: AiSettings) => void;
  readonly stop: () => void;
  readonly discard: () => void;
  readonly addName: (entry: { name: string; note: string; chapter: number }) => void;
  // A new name and note for the entry called `name`, or null to remove it; both survive the next merge.
  readonly editName: (name: string, next: { name: string; note: string } | null) => void;
} {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [job, setJob] = useState<JobState>({ run: null, error: null });

  useEffect(() => {
    setSummary(null);
    setJob({ run: null, error: null });
    const fiber = forkApp(
      Effect.gen(function* () {
        const store = yield* SummaryStore;
        const jobs = yield* SummaryJobs;
        const stored = yield* store
          .get(bookId)
          .pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null)));
        setSummary(stored);
        yield* Effect.all(
          [
            store
              .changes(bookId)
              .pipe(Stream.runForEach((next) => Effect.sync(() => setSummary(next)))),
            jobs.state(bookId).pipe(Stream.runForEach((next) => Effect.sync(() => setJob(next)))),
          ],
          { concurrency: "unbounded" },
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [bookId]);

  const start = useCallback((input: SummaryInput, settings: AiSettings) => {
    forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.start(input, settings)));
  }, []);
  const stop = useCallback(() => {
    forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.stop(bookId)));
  }, [bookId]);
  // The job stops first, so it cannot write the summary back after the removal.
  const discard = useCallback(() => {
    forkApp(
      Effect.gen(function* () {
        yield* (yield* SummaryJobs).stop(bookId);
        yield* (yield* SummaryStore).remove(bookId);
      }),
    );
  }, [bookId]);
  const addName = useCallback(
    (entry: { name: string; note: string; chapter: number }) => {
      const key = entry.name.toLowerCase();
      forkApp(
        Effect.flatMap(SummaryStore, (store) =>
          store.update(bookId, (current) => {
            if (current === null) return null;
            const removed = current.removed.filter((name) => name.trim().toLowerCase() !== key);
            // With no note the next merge writes one; with a note the entry is the reader's now.
            if (entry.note === "") {
              return new Summary({
                ...current,
                removed,
                required: [...current.required, entry.name],
              });
            }
            return new Summary({
              ...current,
              removed,
              names: [
                ...current.names.filter((candidate) => candidate.name.trim().toLowerCase() !== key),
                { ...entry, edited: true },
              ],
            });
          }),
        ),
      );
    },
    [bookId],
  );

  // By name, not position: a merge that lands while the entry is open reorders the list.
  const editName = useCallback(
    (name: string, next: { name: string; note: string } | null) => {
      forkApp(
        Effect.flatMap(SummaryStore, (store) =>
          store.update(bookId, (current) => {
            if (current === null) return null;
            if (next === null) {
              return new Summary({
                ...current,
                names: current.names.filter((entry) => entry.name !== name),
                removed: [...current.removed, name],
              });
            }
            return new Summary({
              ...current,
              names: current.names.map((entry) =>
                entry.name === name ? { ...entry, ...next, edited: true } : entry,
              ),
            });
          }),
        ),
      );
    },
    [bookId],
  );

  return { summary, run: job.run, error: job.error, start, stop, discard, addName, editName };
}
