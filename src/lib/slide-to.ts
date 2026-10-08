import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

// The route changes inside the view transition, so its snapshot of the new page is the new route.
export function slideTo(navigate: NavigateFunction, to: string, direction: "in" | "out"): void {
  // Out of a book opened from the library, a history step back, so a later browser back does not reopen it.
  const back =
    direction === "out" && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const go = (): Promise<void> | void => {
    if (!back) {
      flushSync(() => void navigate(to, { replace: direction === "out" }));
      return;
    }
    // The step lands in a later popstate; the router has its new route once the listeners before this one ran.
    return new Promise((resolve) => {
      window.addEventListener(
        "popstate",
        () => {
          flushSync(() => undefined);
          resolve();
        },
        { once: true },
      );
      window.setTimeout(resolve, 1000);
      void navigate(-1);
    });
  };
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !("startViewTransition" in document)
  ) {
    void go();
    return;
  }
  const root = document.documentElement;
  root.dataset.slide = direction;
  void document.startViewTransition(go).finished.finally(() => delete root.dataset.slide);
}
