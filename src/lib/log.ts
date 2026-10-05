import { Effect, Schema } from "effect";
import { record } from "@/lib/perf";

const STORAGE_KEY = "reader-hero.log-url";
const DEFAULT_ENDPOINT = "/__log";

class LogDeliveryFailed extends Schema.TaggedError<LogDeliveryFailed>()("LogDeliveryFailed", {
  cause: Schema.Defect(),
}) {}

let unreachable = 0;

function destination(): string | null {
  const scope = globalThis as { location?: { search: string }; localStorage?: Storage };
  if (scope.location === undefined || scope.localStorage === undefined) return null;
  const store = scope.localStorage;
  const asked = new URLSearchParams(scope.location.search).get("log");
  if (asked !== null) {
    if (asked === "") store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, asked);
  }
  const configured = store.getItem(STORAGE_KEY);
  if (configured !== null) return configured;
  return import.meta.env.DEV ? DEFAULT_ENDPOINT : null;
}

const send = (url: string, payload: string): Effect.Effect<void, LogDeliveryFailed> =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload,
        keepalive: true,
      }).then(() => undefined),
    catch: (cause) => new LogDeliveryFailed({ cause }),
  });

export function log(name: string, detail = "", ms = 0): Effect.Effect<void> {
  return Effect.gen(function* () {
    record(name, ms, detail);
    const url = destination();
    if (url === null) return;
    const payload = JSON.stringify({ at: Date.now(), name, detail, ms });
    yield* send(url, payload).pipe(
      Effect.catchTag("LogDeliveryFailed", () =>
        Effect.sync(() => {
          unreachable += 1;
          if (unreachable <= 3 || unreachable % 100 === 0) {
            record("log.beacon", 0, `unreachable x${unreachable}`);
          }
        }),
      ),
    );
    unreachable = 0;
  });
}
