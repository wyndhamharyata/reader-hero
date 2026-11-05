import { useRef, type MouseEvent, type PointerEvent } from "react";

const holdMs = 480;
const slopPx = 10;

const blockMenu = (event: Event): void => event.preventDefault();

// The sheet a hold opens lies under the finger, so the browser's own hold menu opens on the sheet and not on the tile.
function blockMenuUntilLift(): void {
  window.addEventListener("contextmenu", blockMenu, true);
  window.addEventListener(
    "pointerup",
    () => window.removeEventListener("contextmenu", blockMenu, true),
    { capture: true, once: true },
  );
}

// A hold or a right-click, or the menu key, runs `onHold`. The click that follows a hold does nothing.
export function useLongPress(onHold: () => void): {
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  readonly onClickCapture: (event: MouseEvent) => void;
} {
  const timer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const wasHeld = useRef(false);

  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (event) => {
      wasHeld.current = false;
      if (event.pointerType === "mouse") return;

      start.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        wasHeld.current = true;
        blockMenuUntilLift();
        onHold();
      }, holdMs);
    },
    onPointerMove: (event) => {
      const distance = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y);

      if (distance > slopPx) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event) => {
      event.preventDefault();
      cancel();
      if (!wasHeld.current) onHold();
    },
    onClickCapture: (event) => {
      if (!wasHeld.current) return;

      wasHeld.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
