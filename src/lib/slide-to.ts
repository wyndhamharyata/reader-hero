import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

let settle: (() => void) | null = null;

// The new page calls this once its first frame is final; outside a slide it does nothing.
export function slideReady(): void {
  settle?.();
  settle = null;
}

// The route changes inside the view transition, so its snapshot of the new page is the new route.
export function slideTo(navigate: NavigateFunction, to: string, direction: "in" | "out"): void {
  const go = (): void => flushSync(() => void navigate(to));
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !("startViewTransition" in document)
  ) {
    go();
    return;
  }
  const root = document.documentElement;
  root.dataset.slide = direction;
  const slide = document.startViewTransition(() => {
    // The old page stays on screen until the new one has its data, theme and position, at most 1s.
    const ready = new Promise<void>((resolve) => {
      settle = resolve;
      window.setTimeout(resolve, 1000);
    });
    go();
    return ready;
  });
  void slide.finished.finally(() => delete root.dataset.slide);
}
