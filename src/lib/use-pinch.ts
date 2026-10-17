import { useEffect, useRef } from "react";

export interface PinchPoint {
  readonly x: number;
  readonly y: number;
}

interface Handlers {
  readonly onPreview: (scale: number, start: PinchPoint, now: PinchPoint) => void;
  readonly onEnd: (scale: number, start: PinchPoint, now: PinchPoint) => void;
  readonly onCancel: () => void;
  readonly clamp: (scale: number) => number;
}

// A trackpad pinch or a ctrl+wheel arrives as many wheel events; this long without one ends it.
const WHEEL_END_MS = 150;

// Points are in the element's own box, so they do not move when the element scrolls.
const local = (element: HTMLElement, x: number, y: number): PinchPoint => {
  const box = element.getBoundingClientRect();
  return { x: x - box.left, y: y - box.top };
};

// By identifier, so a third finger or a lifted one never swaps the pair.
const pair = (touches: TouchList, ids: readonly [number, number]): [Touch, Touch] | null => {
  const found = [...touches].filter((entry) => ids.includes(entry.identifier));
  const [a, b] = found;
  return a === undefined || b === undefined ? null : [a, b];
};

const midpoint = (element: HTMLElement, [a, b]: [Touch, Touch]): PinchPoint =>
  local(element, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);

const spread = ([a, b]: [Touch, Touch]): number =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

// Two fingers, or a trackpad pinch, scale the element's content in place of the browser zooming the whole app.
export function usePinch(element: HTMLElement | null, handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (element === null) return;
    let touch: {
      ids: readonly [number, number];
      from: number;
      start: PinchPoint;
      scale: number;
      now: PinchPoint;
    } | null = null;
    let wheel: {
      start: PinchPoint;
      scale: number;
      timer: ReturnType<typeof setTimeout> | undefined;
    } | null = null;

    // As pdf.js's TouchManager: no move listener until two fingers are down, so a scroll never waits on it.
    let moving: AbortController | null = null;
    const onTouchStart = (event: TouchEvent) => {
      // A gesture under way keeps its own start, whatever finger lands next.
      if (touch !== null || event.touches.length !== 2) return;
      const [a, b] = event.touches;
      if (a === undefined || b === undefined) return;
      const fingers: [Touch, Touch] = [a, b];
      const start = midpoint(element, fingers);
      const ids = [a.identifier, b.identifier] as const;
      touch = { ids, from: spread(fingers), start, scale: 1, now: start };
      if (moving !== null) return;
      moving = new AbortController();
      // Not passive, so the two-finger move pans nothing while it scales.
      element.addEventListener("touchmove", onTouchMove, { passive: false, signal: moving.signal });
    };
    const onTouchMove = (event: TouchEvent) => {
      const fingers = touch === null ? null : pair(event.touches, touch.ids);
      if (touch === null || fingers === null || touch.from === 0) return;
      event.preventDefault();
      touch.scale = spread(fingers) / touch.from;
      touch.now = midpoint(element, fingers);
      latest.current.onPreview(touch.scale, touch.start, touch.now);
    };
    const finish = () => {
      const ended = touch;
      touch = null;
      moving?.abort();
      moving = null;
      return ended;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (touch === null || pair(event.touches, touch.ids) !== null) return;
      const ended = finish();
      if (ended !== null) latest.current.onEnd(ended.scale, ended.start, ended.now);
    };
    const onTouchCancel = () => {
      if (finish() !== null) latest.current.onCancel();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const point = local(element, event.clientX, event.clientY);
      wheel ??= { start: point, scale: 1, timer: undefined };
      clearTimeout(wheel.timer);
      wheel.scale = latest.current.clamp(wheel.scale * Math.exp(-event.deltaY / 100));
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
    // Not passive, as in pdf.js, so the move listener added on the second finger can stop the pan.
    element.addEventListener("touchstart", onTouchStart, options);
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchCancel);
    element.addEventListener("wheel", onWheel, options);
    element.addEventListener("gesturestart", stop, options);
    element.addEventListener("gesturechange", stop, options);
    return () => {
      if (wheel !== null) clearTimeout(wheel.timer);
      moving?.abort();
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", stop);
      element.removeEventListener("gesturechange", stop);
    };
  }, [element]);
}
