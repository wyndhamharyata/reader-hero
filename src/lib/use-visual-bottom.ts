import { useLayoutEffect, useState } from "react";

// How much of the layout viewport the bottom of the screen hides: iOS grows only the visual viewport for the keyboard.
export function useVisualBottom(isWanted: boolean): number {
  const [covered, setCovered] = useState(0);

  useLayoutEffect(() => {
    const view = window.visualViewport;

    if (!isWanted || view === null) return;

    const update = (): void => {
      setCovered(Math.max(0, window.innerHeight - view.height - view.offsetTop));
    };

    update();
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update);

    return () => {
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update);
    };
  }, [isWanted]);

  return covered;
}
