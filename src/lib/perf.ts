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

/** Times an effect and records it, whether it succeeds, fails, or is interrupted. */
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

/** Captures console warnings (pdf.js warns here when it falls back to a fake worker). */
export async function captureWarnings<T>(
  run: () => Promise<T>,
): Promise<{ readonly result: T; readonly warnings: ReadonlyArray<string> }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
    original.apply(console, args);
  };
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
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
