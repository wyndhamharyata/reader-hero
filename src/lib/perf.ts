import { Effect } from "effect";

export interface PerfEntry {
  readonly name: string;
  readonly ms: number;
  readonly detail: string;
  readonly at: number;
}

const MAX_ENTRIES = 1000;
const entries: PerfEntry[] = [];
const listeners = new Set<() => void>();

export function record(name: string, ms: number, detail = ""): void {
  entries.push({ name, ms, detail, at: Date.now() });
  while (entries.length > MAX_ENTRIES) entries.shift();
  for (const listener of listeners) listener();
}

export function timed<A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  detail?: (value: A) => string,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const started = performance.now();
    let label = "";
    return effect.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          label = detail === undefined ? "" : detail(value);
        }),
      ),
      Effect.ensuring(Effect.sync(() => record(name, performance.now() - started, label))),
    );
  });
}

export function captureWarnings<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  { readonly result: A; readonly warnings: ReadonlyArray<string> },
  E,
  R
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const warnings: string[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = console.warn;
          console.warn = (...args: unknown[]) => {
            warnings.push(args.map((arg) => String(arg)).join(" "));
            previous.apply(console, args);
          };
          return () => {
            console.warn = previous;
          };
        }),
        (restore) => Effect.sync(restore),
      );
      return { result: yield* effect, warnings };
    }),
  );
}

export function snapshot(): ReadonlyArray<PerfEntry> {
  return [...entries].reverse();
}

export function clearEntries(): void {
  entries.length = 0;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
