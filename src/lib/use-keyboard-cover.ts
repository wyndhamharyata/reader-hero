import { useEffect, type RefObject } from "react";

export function useKeyboardCover(
  barRef: RefObject<HTMLElement | null>,
  coverRef: RefObject<HTMLElement | null>,
): void {
  // iOS paints the page, not fixed elements, under its keyboard, and never undoes its focus scroll.
  useEffect(() => {
    const bar = barRef.current;
    const cover = coverRef.current;
    const viewport = window.visualViewport;
    if (bar === null || cover === null) return;
    let scrollY = 0;
    const place = (): void => {
      cover.style.top = `${bar.getBoundingClientRect().bottom + window.scrollY}px`;
    };
    const open = (): void => {
      scrollY = window.scrollY;
      cover.style.display = "block";
      place();
    };
    const close = (): void => {
      cover.style.display = "none";
      window.scrollTo({ top: scrollY });
    };
    bar.addEventListener("focusin", open);
    bar.addEventListener("focusout", close);
    window.addEventListener("scroll", place, { passive: true });
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      bar.removeEventListener("focusin", open);
      bar.removeEventListener("focusout", close);
      window.removeEventListener("scroll", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [barRef, coverRef]);
}
