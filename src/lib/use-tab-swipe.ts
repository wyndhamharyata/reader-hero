import { useEffect, useRef, type RefObject } from "react";

interface Swipe {
  x: number;
  y: number;
  at: number;
  width: number;
  axis: "none" | "x" | "y";
  dx: number;
}

// A sideways swipe drags the tab panels with the finger; the axis locks on the first move.
export function useTabSwipe<T>(
  viewport: RefObject<HTMLElement | null>,
  track: RefObject<HTMLElement | null>,
  tabs: ReadonlyArray<T>,
  tab: T,
  onTab: (next: T) => void,
): void {
  // Outside the effect, so a render mid-swipe, as each streamed word of a summary makes, keeps the swipe.
  const swipe = useRef<Swipe | null>(null);
  const latest = useRef({ tabs, tab, onTab });
  useEffect(() => {
    latest.current = { tabs, tab, onTab };
  });

  // No dependency list: it binds again after each render, so it follows a late mount.
  useEffect(() => {
    const box = viewport.current;
    const rail = track.current;
    if (box === null || rail === null) return;
    const index = (): number => latest.current.tabs.indexOf(latest.current.tab);
    const last = (): number => latest.current.tabs.length - 1;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      // A slider takes its own sideways drag.
      swipe.current =
        touch === undefined || (event.target as Element).closest('input[type="range"]') !== null
          ? null
          : {
              x: touch.clientX,
              y: touch.clientY,
              at: event.timeStamp,
              width: box.clientWidth,
              axis: "none",
              dx: 0,
            };
    };
    // Native listeners: React's touchmove is passive and cannot stop the panel's scroll.
    const onMove = (event: TouchEvent): void => {
      const state = swipe.current;
      const touch = event.touches[0];
      if (state === null || touch === undefined) return;
      const dx = touch.clientX - state.x;
      const dy = touch.clientY - state.y;
      if (state.axis === "none") {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        state.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (state.axis === "x") rail.style.transition = "none";
      }
      if (state.axis !== "x") return;
      event.preventDefault();
      state.dx = dx;
      const offset = -index() * state.width + dx;
      rail.style.transform = `translateX(${Math.max(-last() * state.width, Math.min(0, offset))}px)`;
    };
    const settle = (next: number): void => {
      rail.style.transition = "";
      rail.style.transform = `translateX(${-next * 100}%)`;
      const value = latest.current.tabs[next];
      if (value !== undefined) latest.current.onTab(value);
    };
    const onEnd = (event: TouchEvent): void => {
      const done = swipe.current;
      swipe.current = null;
      if (done === null || done.axis !== "x") return;
      const speed = Math.abs(done.dx) / Math.max(1, event.timeStamp - done.at);
      const far = Math.abs(done.dx) > done.width / 4 || (Math.abs(done.dx) > 30 && speed > 0.5);
      settle(far ? Math.max(0, Math.min(last(), index() + (done.dx < 0 ? 1 : -1))) : index());
    };
    const onCancel = (): void => {
      swipe.current = null;
      settle(index());
    };
    box.addEventListener("touchstart", onStart, { passive: true });
    box.addEventListener("touchmove", onMove, { passive: false });
    box.addEventListener("touchend", onEnd);
    box.addEventListener("touchcancel", onCancel);
    return () => {
      box.removeEventListener("touchstart", onStart);
      box.removeEventListener("touchmove", onMove);
      box.removeEventListener("touchend", onEnd);
      box.removeEventListener("touchcancel", onCancel);
    };
  });
}
