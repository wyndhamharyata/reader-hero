import { useEffect, useRef } from "react";

export interface PinchPoint {
  readonly x: number;
  readonly y: number;
}

interface Handlers {
  // Each move of the gesture: the scale since it began, where it began, and where the fingers are now.
  readonly onPreview: (scale: number, start: PinchPoint, now: PinchPoint) => void;
  readonly onEnd: (scale: number, start: PinchPoint, now: PinchPoint) => void;
}

// A trackpad pinch or a ctrl+wheel arrives as many wheel events; this long without one ends it.
const WHEEL_END_MS = 150;

// Points are in the element's own box, so they do not move when the element scrolls.
const local = (element: HTMLElement, x: number, y: number): PinchPoint => {
  const box = element.getBoundingClientRect();
  return { x: x - box.left, y: y - box.top };
};

const midpoint = (element: HTMLElement, touches: TouchList): PinchPoint => {
  const a = touches[0];
  const b = touches[1];
  if (a === undefined || b === undefined) return { x: 0, y: 0 };
  return local(element, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
};

const spread = (touches: TouchList): number => {
  const a = touches[0];
  const b = touches[1];
  if (a === undefined || b === undefined) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
};

// Two fingers, or a trackpad pinch, scale the element's content in place of the browser zooming the whole app.
export function usePinch(element: HTMLElement | null, handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (element === null) return;
    let touch: { from: number; start: PinchPoint; scale: number; now: PinchPoint } | null = null;
    let wheel: {
      start: PinchPoint;
      scale: number;
      timer: ReturnType<typeof setTimeout> | undefined;
    } | null = null;

    // As pdf.js's TouchManager: a move listener only while two fingers are down, so a one-finger scroll never waits on one.
    let moving: AbortController | null = null;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const start = midpoint(element, event.touches);
      touch = { from: spread(event.touches), start, scale: 1, now: start };
      if (moving !== null) return;
      moving = new AbortController();
      // Not passive, so the two-finger move pans nothing while it scales.
      element.addEventListener("touchmove", onTouchMove, { passive: false, signal: moving.signal });
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touch === null || event.touches.length !== 2 || touch.from === 0) return;
      event.preventDefault();
      touch.scale = spread(event.touches) / touch.from;
      touch.now = midpoint(element, event.touches);
      latest.current.onPreview(touch.scale, touch.start, touch.now);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (touch === null || event.touches.length >= 2) return;
      const ended = touch;
      touch = null;
      moving?.abort();
      moving = null;
      latest.current.onEnd(ended.scale, ended.start, ended.now);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const point = local(element, event.clientX, event.clientY);
      wheel ??= { start: point, scale: 1, timer: undefined };
      clearTimeout(wheel.timer);
      wheel.scale *= Math.exp(-event.deltaY / 100);
      const current = wheel;
      latest.current.onPreview(current.scale, current.start, current.start);
      current.timer = setTimeout(() => {
        wheel = null;
        latest.current.onEnd(current.scale, current.start, current.start);
      }, WHEEL_END_MS);
    };
    // Safari's own pinch events, which zoom the page unless stopped.
    const stop = (event: Event) => event.preventDefault();

    const options = { passive: false } as const;
    // Not passive either, as pdf.js has it, so the browser holds the gesture for the move listener added on the second finger.
    element.addEventListener("touchstart", onTouchStart, options);
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    element.addEventListener("wheel", onWheel, options);
    element.addEventListener("gesturestart", stop, options);
    element.addEventListener("gesturechange", stop, options);
    return () => {
      if (wheel !== null) clearTimeout(wheel.timer);
      moving?.abort();
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", stop);
      element.removeEventListener("gesturechange", stop);
    };
  }, [element]);
}
