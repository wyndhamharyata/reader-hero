import { Effect } from "effect";

// The system drops the lock when the app hides, so it is taken again on return.
export function holdWakeLock(): Effect.Effect<never> {
  return Effect.callback<never>(() => {
    let held: WakeLockSentinel | null = null;
    let done = false;
    const take = (): void => {
      if (done || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock.request("screen").then(
        (sentinel) => {
          // A lock granted after the reader closed goes back at once.
          if (done) void sentinel.release().catch(() => undefined);
          else held = sentinel;
        },
        () => undefined,
      );
    };
    take();
    document.addEventListener("visibilitychange", take);
    return Effect.sync(() => {
      done = true;
      document.removeEventListener("visibilitychange", take);
      void held?.release().catch(() => undefined);
    });
  });
}
