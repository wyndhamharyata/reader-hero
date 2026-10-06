import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { DEFAULT_SETTINGS, type BookMeta, ReaderSettings } from "@/domain/book";
import { runtime, type AppServices } from "@/runtime";
import { SettingsStore } from "@/services/settings-store";
import { watchBookImage } from "@/use-cases/book-image";
import { renderFigures } from "@/use-cases/render-figures";

export type AsyncState<A, E> =
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

export function useFigureJobs(books: ReadonlyArray<BookMeta>): void {
  const jobs = useRef(new Map<string, Job>());

  useEffect(() => {
    for (const book of books) {
      if (!book.figuresPending || jobs.current.has(book.id)) continue;
      const bookId = book.id;
      const job = renderFigures(bookId).pipe(
        Effect.ensuring(Effect.sync(() => jobs.current.delete(bookId))),
      );
      jobs.current.set(bookId, forkApp(job));
    }
  }, [books]);

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
    let active = true;
    // A reload keeps the current value on screen until the new one arrives; only new deps show loading.
    if (lastNonce.current === nonce) setState({ status: "loading" });
    lastNonce.current = nonce;
    runtime.runPromise(effect).then(
      (value) => {
        if (active) setState({ status: "done", value });
      },
      (error: E) => {
        if (active) setState({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
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
    void runtime.runPromise(Effect.flatMap(SettingsStore, (store) => store.update(patch)));
  }, []);

  return { settings, update };
}
