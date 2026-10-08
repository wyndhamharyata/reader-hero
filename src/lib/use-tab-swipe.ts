import { useEffect, type RefObject } from "react";

// A sideways swipe drags the tab panels with the finger; the axis locks on the first move.
export function useTabSwipe<T>(
  viewport: RefObject<HTMLElement | null>,
  track: RefObject<HTMLElement | null>,
  tabs: ReadonlyArray<T>,
  tab: T,
  onTab: (next: T) => void,
): void {
  // No dependency list: it binds again after each render, so it follows the tab and a late mount.
  useEffect(() => {
    const box = viewport.current;
    const rail = track.current;
    if (box === null || rail === null) return;
    const index = tabs.indexOf(tab);
    const last = tabs.length - 1;
    let state: {
      x: number;
      y: number;
      at: number;
      width: number;
      axis: "none" | "x" | "y";
      dx: number;
    } | null = null;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      // A slider takes its own sideways drag.
      state =
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
      const offset = -index * state.width + dx;
      rail.style.transform = `translateX(${Math.max(-last * state.width, Math.min(0, offset))}px)`;
    };
    const settle = (next: number): void => {
      rail.style.transition = "";
      rail.style.transform = `translateX(${-next * 100}%)`;
      const value = tabs[next];
      if (value !== undefined) onTab(value);
    };
    const onEnd = (event: TouchEvent): void => {
      const done = state;
      state = null;
      if (done === null || done.axis !== "x") return;
      const speed = Math.abs(done.dx) / Math.max(1, event.timeStamp - done.at);
      const far = Math.abs(done.dx) > done.width / 4 || (Math.abs(done.dx) > 30 && speed > 0.5);
      settle(far ? Math.max(0, Math.min(last, index + (done.dx < 0 ? 1 : -1))) : index);
    };
    const onCancel = (): void => {
      state = null;
      settle(index);
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
