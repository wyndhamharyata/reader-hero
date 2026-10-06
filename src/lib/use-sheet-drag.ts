import { useEffect, useRef, type RefObject } from "react";

// Native listeners: React's touchmove is passive and cannot stop the scrolling list's own bounce.
export function useSheetDrag(
  open: boolean,
  sheetRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || sheet === null) return;
    let startY = 0;
    let startAt = 0;
    let offset = 0;
    let mode: "idle" | "drag" | "scroll" = "idle";

    const onStart = (event: TouchEvent): void => {
      mode = window.matchMedia("(width >= 48rem)").matches ? "scroll" : "idle";
      startY = event.touches[0]?.clientY ?? 0;
      startAt = event.timeStamp;
      offset = 0;
    };
    const onMove = (event: TouchEvent): void => {
      const y = event.touches[0]?.clientY;
      if (mode === "scroll" || y === undefined) return;
      const dy = y - startY;
      if (mode === "idle") {
        const list = scrollRef.current;
        const inList = list !== null && list.contains(event.target as Node);
        mode = dy > 0 && (!inList || list.scrollTop <= 0) ? "drag" : "scroll";
        if (mode === "scroll") return;
        sheet.style.transition = "none";
      }
      event.preventDefault();
      offset = Math.max(0, dy);
      sheet.style.transform = `translateY(${offset}px)`;
    };
    const onEnd = (event: TouchEvent): void => {
      if (mode !== "drag") return;
      mode = "idle";
      const flick = offset > 30 && offset / Math.max(1, event.timeStamp - startAt) > 0.5;
      sheet.style.transition = "transform 200ms ease-out";
      if (offset < 100 && !flick) {
        sheet.style.transform = "";
        return;
      }
      sheet.style.transform = "translateY(100%)";
      window.setTimeout(() => closeRef.current(), 200);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [open, sheetRef, scrollRef]);
}
