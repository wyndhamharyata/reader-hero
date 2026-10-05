import { Effect } from "effect";

export function requestPersistentStorage(): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: () => navigator.storage.persist(),
    catch: () => false,
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

export function isIosBrowser(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || standalone;
}
