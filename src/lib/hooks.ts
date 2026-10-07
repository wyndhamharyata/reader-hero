import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
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
  const [image, setImage] = useState<{ url: string; ratio: number | null } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    const fiber = forkApp(
      watchBookImage(bookId, imageId, (record) => {
        if (record === null) return;
        if (url !== null) URL.revokeObjectURL(url);
        url = URL.createObjectURL(record.blob);
        setImage({ url, ratio: record.height === 0 ? null : record.width / record.height });
      }),
    );
    return () => {
      stopFiber(fiber);
      if (url !== null) URL.revokeObjectURL(url);
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

export function useSettings(): {
  readonly settings: ReaderSettings;
  readonly update: (patch: Partial<ReaderSettings>) => void;
} {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const store = yield* SettingsStore;
        yield* Stream.runForEach(store.changes(), (next) => Effect.sync(() => setSettings(next)));
      }),
    );
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

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
  readonly addName: (name: string) => void;
  // A new name and note for the entry at `index`, or null to remove it; both survive the next merge.
  readonly editName: (index: number, next: { name: string; note: string } | null) => void;
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
    (name: string) => {
      forkApp(
        Effect.flatMap(SummaryStore, (store) =>
          store.update(bookId, (current) =>
            current === null
              ? null
              : new Summary({ ...current, required: [...current.required, name] }),
          ),
        ),
      );
    },
    [bookId],
  );

  const editName = useCallback(
    (index: number, next: { name: string; note: string } | null) => {
      forkApp(
        Effect.flatMap(SummaryStore, (store) =>
          store.update(bookId, (current) => {
            const entry = current?.names[index];
            if (current === null || entry === undefined) return null;
            if (next === null) {
              return new Summary({
                ...current,
                names: current.names.filter((_, at) => at !== index),
                removed: [...current.removed, entry.name],
              });
            }
            return new Summary({
              ...current,
              names: current.names.map((candidate, at) =>
                at === index ? { ...candidate, ...next, edited: true } : candidate,
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
