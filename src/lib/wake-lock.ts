import { Effect } from "effect";

export function requestWakeLock(): Effect.Effect<WakeLockSentinel | null> {
  return Effect.tryPromise({
    try: () => navigator.wakeLock.request("screen"),
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));
}

export function releaseWakeLock(sentinel: WakeLockSentinel | null): void {
  if (sentinel === null) return;
  void sentinel.release();
}
