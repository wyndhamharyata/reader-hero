import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

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
  void document.startViewTransition(go).finished.finally(() => delete root.dataset.slide);
}
