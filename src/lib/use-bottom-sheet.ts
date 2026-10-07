import { useCallback, useEffect, useRef, type RefObject } from "react";

const closeMs = 200;

// The open sheets, bottom to top. Escape dismisses the top one only, so a summary over the
// sidebar closes first and the sidebar on the next press.
const openSheets: Array<symbol> = [];

// Slides a sheet out (down on phones, right for the desktop sidebar) and fades its backdrop, then closes.
function slideOut(sheet: HTMLElement, backdrop: HTMLElement | null, done: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  const sideways = window.matchMedia("(width >= 48rem)").matches;
  sheet.style.transition = `transform ${closeMs}ms ease-in`;
  sheet.style.transform = sideways ? "translateX(100%)" : "translateY(100%)";
  if (backdrop !== null) {
    backdrop.style.transition = `opacity ${closeMs}ms ease-in`;
    backdrop.style.opacity = "0";
  }
  window.setTimeout(done, closeMs);
}

export function useBottomSheet(
  open: boolean,
  sheetRef: RefObject<HTMLElement | null>,
  backdropRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): { readonly dismiss: (then?: () => void) => void } {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  const dismiss = useCallback(
    (then?: () => void): void => {
      const finish = (): void => {
        closeRef.current();
        then?.();
      };
      const sheet = sheetRef.current;
      if (sheet === null) finish();
      else slideOut(sheet, backdropRef.current, finish);
    },
    [sheetRef, backdropRef],
  );

  useEffect(() => {
    if (!open) return;
    const token = Symbol("sheet");
    openSheets.push(token);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || openSheets[openSheets.length - 1] !== token) return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      openSheets.splice(openSheets.indexOf(token), 1);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  // Native listeners: React's touchmove is passive and cannot stop the scrolling list's own bounce.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || sheet === null) return;
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let offset = 0;
    let mode: "idle" | "drag" | "scroll" = "idle";

    const onStart = (event: TouchEvent): void => {
      mode = window.matchMedia("(width >= 48rem)").matches ? "scroll" : "idle";
      startX = event.touches[0]?.clientX ?? 0;
      startY = event.touches[0]?.clientY ?? 0;
      startAt = event.timeStamp;
      offset = 0;
    };
    const onMove = (event: TouchEvent): void => {
      const y = event.touches[0]?.clientY;
      if (mode === "scroll" || y === undefined) return;
      const dy = y - startY;
      const dx = (event.touches[0]?.clientX ?? startX) - startX;
      if (mode === "idle") {
        // Any scrolled area under the finger scrolls back up first; the sheet drags only from the top.
        let scrolled = false;
        for (let node = event.target as Element | null; node !== null && node !== sheet;) {
          scrolled ||= node.scrollTop > 0;
          node = node.parentElement;
        }
        // A sideways swipe belongs to the content, such as the summary's tabs.
        mode = dy > 0 && dy > Math.abs(dx) && !scrolled ? "drag" : "scroll";
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
      if (offset < 100 && !flick) {
        sheet.style.transition = "transform 200ms ease-out";
        sheet.style.transform = "";
        return;
      }
      slideOut(sheet, backdropRef.current, () => closeRef.current());
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
  }, [open, sheetRef, backdropRef]);

  return { dismiss };
}
