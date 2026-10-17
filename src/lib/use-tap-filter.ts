import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent } from "react";

const hasSelection = (): boolean => {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
};

// A click that ends a text selection, or only clears one, is about the text, not a tap on the page.
export function useTapFilter(): {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly isTap: (event: MouseEvent) => boolean;
} {
  const down = useRef<{ x: number; y: number; hasSelection: boolean } | null>(null);

  return {
    onPointerDown: (event) => {
      down.current = { x: event.clientX, y: event.clientY, hasSelection: hasSelection() };
    },
    isTap: (event) => {
      const start = down.current;

      down.current = null;
      if (hasSelection()) return false;
      if (start === null) return true;

      return (
        !start.hasSelection && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10
      );
    },
  };
}
