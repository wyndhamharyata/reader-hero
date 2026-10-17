import { useEffect } from "react";
import type { NavigateFunction } from "react-router";
import { slideTo } from "@/lib/slide-to";

function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;

  return (
    target !== null &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
}

// Moves are smooth so the eye can follow. The effect is off under a sheet or the tour, which take Escape.
export function useReaderKeys({
  isEnabled,
  isSearchOpen,
  setSearchOpen,
  setTocOpen,
  navigate,
  fontSize,
  lineHeight,
}: {
  readonly isEnabled: boolean;
  readonly isSearchOpen: boolean;
  readonly setSearchOpen: (isOpen: boolean) => void;
  readonly setTocOpen: (isOpen: boolean) => void;
  readonly navigate: NavigateFunction;
  readonly fontSize: number;
  readonly lineHeight: number;
}): void {
  useEffect(() => {
    if (!isEnabled) return;

    const line = fontSize * lineHeight;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    const scroller = (): HTMLElement | null => document.querySelector("[data-scroller]");
    let held: {
      key: string;
      direction: 1 | -1;
      since: number;
      last: number;
      frame: number;
    } | null = null;
    const stop = (): void => {
      if (held !== null) cancelAnimationFrame(held.frame);
      held = null;
    };
    // A clock of its own, not key repeat, which starts late and moves in steps.
    const run = (now: number): void => {
      if (held === null) return;

      const seconds = (now - held.last) / 1000;
      const heldFor = (now - held.since) / 1000;

      held.last = now;

      const target = scroller();

      if (heldFor > 0.12 && target !== null) {
        const speed = Math.min(36, 12 + (heldFor - 0.12) * 12) * line;

        target.scrollBy({ top: held.direction * speed * seconds });
      }

      held.frame = requestAnimationFrame(run);
    };
    const jump = (direction: 1 | -1, isInstant: boolean): void => {
      const target = scroller();

      if (target === null) return;

      const top = target.getBoundingClientRect().top + 16;
      const items = Array.from(target.querySelectorAll<HTMLElement>("[data-block], [data-page]"));
      const next =
        direction === 1
          ? items.find((item) => item.getBoundingClientRect().top > top + 2)
          : items.reverse().find((item) => item.getBoundingClientRect().top < top - 2);

      target.scrollBy({
        top:
          next === undefined
            ? (direction * target.clientHeight) / 2
            : next.getBoundingClientRect().top - top,
        behavior: isInstant ? "auto" : behavior,
      });
    };
    const scroll = (event: KeyboardEvent, direction: 1 | -1): void => {
      if (event.repeat) return;

      scroller()?.scrollBy({ top: direction * 2 * line, behavior });
      if (held !== null) return;

      const now = performance.now();

      held = {
        key: event.key,
        direction,
        since: now,
        last: now,
        frame: requestAnimationFrame(run),
      };
    };
    const closeOrLeave = (event: KeyboardEvent): void => {
      // Escape closes the search first, as a browser's find does.
      if (isSearchOpen) setSearchOpen(false);
      else if (!event.repeat) slideTo(navigate, "/", "out");
    };
    const handleKey = (event: KeyboardEvent): boolean => {
      switch (event.key) {
        case "Escape":
          closeOrLeave(event);
          return true;
        case "ArrowDown":
        case "j":
          if (event.ctrlKey) return false;

          scroll(event, 1);
          return true;
        case "ArrowUp":
        case "k":
          if (event.ctrlKey) return false;

          scroll(event, -1);
          return true;
        case "d":
          if (!event.ctrlKey) return false;

          jump(1, event.repeat);
          return true;
        case "u":
          if (!event.ctrlKey) return false;

          jump(-1, event.repeat);
          return true;
        case "s":
          if (event.ctrlKey) return false;

          setTocOpen(true);
          return true;
        default:
          return false;
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event) || event.metaKey || event.altKey) return;
      if (!handleKey(event)) return;

      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (held !== null && event.key === held.key) stop();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);

    return () => {
      stop();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
    };
  }, [isEnabled, isSearchOpen, setSearchOpen, setTocOpen, navigate, fontSize, lineHeight]);
}
