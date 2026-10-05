import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useState, type DependencyList } from "react";
import { DEFAULT_SETTINGS, ReaderSettings } from "@/domain/book";
import { runtime, type AppServices } from "@/runtime";
import { SettingsStore } from "@/services/settings-store";

export type AsyncState<A, E> =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly value: A }
  | { readonly status: "error"; readonly error: E };

export function runApp<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return runtime.runPromise(effect);
}

export function useAppEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  deps: DependencyList,
): { readonly state: AsyncState<A, E>; readonly reload: () => void } {
  const [state, setState] = useState<AsyncState<A, E>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
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
