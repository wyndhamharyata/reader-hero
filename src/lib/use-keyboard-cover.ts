import { useCallback, useEffect, useRef, type RefObject } from "react";

// Returns `restAt`: where the page goes when the keyboard closes, such as the top for a new search.
export function useKeyboardCover(
  barRef: RefObject<HTMLElement | null>,
  coverRef: RefObject<HTMLElement | null>,
): (top: number) => void {
  const restRef = useRef<(top: number) => void>(() => {});

  // iOS paints the page, not fixed elements, under its keyboard, and never undoes its focus scroll.
  useEffect(() => {
    const bar = barRef.current;
    const cover = coverRef.current;
    const viewport = window.visualViewport;
    if (bar === null || cover === null) return;
    // Null once the reader drags the page with the keyboard up: their own scroll then stays.
    let rest: number | null = null;
    let tappedAt = -Infinity;
    const place = (): void => {
      // With the keyboard up, the bar rides the visible area's bottom edge, so a scroll to the top keeps it in view.
      const lift =
        cover.style.display === "block" && viewport !== null
          ? Math.min(0, viewport.offsetTop + viewport.height - window.innerHeight)
          : 0;
      bar.style.transform = lift === 0 ? "" : `translateY(${lift}px)`;
      cover.style.top = `${bar.getBoundingClientRect().bottom + window.scrollY}px`;
    };
    const open = (): void => {
      rest = window.scrollY;
      cover.style.display = "block";
      place();
    };
    const close = (): void => {
      cover.style.display = "none";
      bar.style.transform = "";
      // A tap that closes the keyboard moves the page after its click, and not at all if it opened a book.
      if (performance.now() - tappedAt > 700) {
        if (rest !== null) window.scrollTo({ top: rest });
        return;
      }
      const done = (event?: Event): void => {
        window.removeEventListener("click", done);
        window.clearTimeout(timer);
        if (rest !== null && event?.defaultPrevented !== true) window.scrollTo({ top: rest });
      };
      window.addEventListener("click", done);
      const timer = window.setTimeout(done, 500);
    };
    const onDown = (event: PointerEvent): void => {
      if (!bar.contains(event.target as Node)) tappedAt = performance.now();
    };
    const onDrag = (event: TouchEvent): void => {
      if (cover.style.display === "block" && !bar.contains(event.target as Node)) rest = null;
    };
    restRef.current = (top) => {
      rest = top;
    };
    bar.addEventListener("focusin", open);
    bar.addEventListener("focusout", close);
    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("touchmove", onDrag, { passive: true });
    window.addEventListener("scroll", place, { passive: true });
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      bar.removeEventListener("focusin", open);
      bar.removeEventListener("focusout", close);
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("touchmove", onDrag);
      window.removeEventListener("scroll", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [barRef, coverRef]);

  return useCallback((top: number) => restRef.current(top), []);
}
