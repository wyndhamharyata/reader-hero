import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

const growMs = 320;
const fadeMs = 160;
const swingMs = 650;

export function prefersLessMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The cover grows to fill the screen, the book opens under it, then the cover fades. A first open swings it open instead.
export function openBook(
  navigate: NavigateFunction,
  bookId: string,
  cover: Element | null,
  isFirstOpen: boolean,
): void {
  const to = `/book/${bookId}`;

  if (cover === null || prefersLessMotion()) {
    void navigate(to);
    return;
  }

  const box = cover.getBoundingClientRect();
  const clone = cover.cloneNode(true) as HTMLElement;
  const from = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
  const full = { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px` };

  clone.classList.add("zoomer");
  Object.assign(clone.style, from);
  document.body.append(clone);

  const grow = clone.animate(
    [
      { ...from, borderRadius: "2px 5px 5px 2px" },
      { ...full, borderRadius: "0px" },
    ],
    { duration: growMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
  );
  const swing = [
    { transform: "perspective(1800px) rotateY(0deg)", opacity: 1 },
    { transform: "perspective(1800px) rotateY(-105deg)", opacity: 0.2 },
  ];

  void grow.finished
    .then(() => {
      flushSync(() => void navigate(to));

      const reveal = isFirstOpen
        ? clone.animate(swing, {
            duration: swingMs,
            easing: "cubic-bezier(0.5, 0, 0.3, 1)",
            fill: "forwards",
          })
        : clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs, fill: "forwards" });

      return reveal.finished;
    })
    .finally(() => clone.remove());
}
