import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

let settle: (() => void) | null = null;

// The new page calls this once its first frame is final; outside a slide it does nothing.
export function slideReady(): void {
  settle?.();
  settle = null;
}

// The book being opened, which renders hidden under the library until it is ready.
let opening: { readonly to: string; readonly waiting: boolean } | null = null;
const listeners = new Set<() => void>();
const setOpening = (next: typeof opening): void => {
  opening = next;
  for (const listener of listeners) listener();
};

export function useOpening(): typeof opening {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => opening,
  );
}

// The book loads, places and paints its first screen out of sight; only then does it slide in.
export function openBook(navigate: NavigateFunction, to: string): void {
  if (opening !== null) return;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
    window.setTimeout(resolve, 5000);
  });
  setOpening({ to, waiting: false });
  // A fast open shows nothing; a slow one says it is working.
  const timer = window.setTimeout(() => setOpening({ to, waiting: true }), 150);
  void ready.then(() => {
    window.clearTimeout(timer);
    const go = (): void =>
      flushSync(() => {
        setOpening(null);
        void navigate(to);
      });
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("startViewTransition" in document)
    ) {
      go();
      return;
    }
    // Off before the library's snapshot, so the indicator does not slide out with it.
    flushSync(() => setOpening({ to, waiting: false }));
    const root = document.documentElement;
    root.dataset.slide = "in";
    void document.startViewTransition(go).finished.finally(() => delete root.dataset.slide);
  });
}

// The route changes inside the view transition, so its snapshot of the new page is the new route.
export function slideBack(navigate: NavigateFunction): void {
  const go = (): void => flushSync(() => void navigate("/"));
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !("startViewTransition" in document)
  ) {
    go();
    return;
  }
  const root = document.documentElement;
  root.dataset.slide = "out";
  const slide = document.startViewTransition(() => {
    // The book stays on screen until the library has its shelf, at most 1s.
    const ready = new Promise<void>((resolve) => {
      settle = resolve;
      window.setTimeout(resolve, 1000);
    });
    go();
    return ready;
  });
  void slide.finished.finally(() => delete root.dataset.slide);
}
