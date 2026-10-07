import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

let settle: (() => void) | null = null;
// Resolves once the book being opened is ready, or after 5s.
let ready: Promise<void> = Promise.resolve();

// The new page calls this once its first frame is final; outside a slide it does nothing.
export function slideReady(): void {
  settle?.();
  settle = null;
}

// The book being opened, hidden under the library: "pressed" prepares it, "opening" also takes taps.
let opening: { readonly to: string; readonly stage: "pressed" | "opening" | "waiting" } | null =
  null;
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

// Open on press: the book starts to prepare when the finger lands, so the tap's own length counts
// toward the open. To open on click only, remove this and its one call in SlideLink.
export function pressBook(to: string, pointerId: number): void {
  if (opening !== null && opening.stage !== "pressed") return;
  ready = new Promise<void>((resolve) => {
    settle = resolve;
    window.setTimeout(resolve, 5000);
  });
  setOpening({ to, stage: "pressed" });
  const pressed = opening;
  const drop = (event: Event): void => {
    if (event instanceof PointerEvent && event.pointerId !== pointerId) return;
    window.removeEventListener("pointerup", drop);
    window.removeEventListener("pointercancel", drop);
    window.removeEventListener("dragstart", drop);
    // A scroll or a drag drops it at once; a release waits for the click that opens the book.
    window.setTimeout(
      () => {
        if (opening !== pressed) return;
        settle = null;
        setOpening(null);
      },
      event.type === "pointerup" ? 1000 : 0,
    );
  };
  window.addEventListener("pointerup", drop);
  window.addEventListener("pointercancel", drop);
  // Dragging a link starts the browser's own drag, which ends the press with no pointer event.
  window.addEventListener("dragstart", drop);
}

// The book loads, places and paints its first screen out of sight; only then does it slide in.
export function openBook(navigate: NavigateFunction, to: string): void {
  if (opening !== null && opening.stage !== "pressed") return;
  // A press on this book has already started it; any other press is dropped.
  if (opening?.to !== to) {
    ready = new Promise<void>((resolve) => {
      settle = resolve;
      window.setTimeout(resolve, 5000);
    });
  }
  setOpening({ to, stage: "opening" });
  // Above a usual open's time, so only a slow open says it is working, and a usual one never flashes.
  const timer = window.setTimeout(() => setOpening({ to, stage: "waiting" }), 400);
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
    // The indicator stays in the library's snapshot and leaves with it, so it does not blink off first.
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
