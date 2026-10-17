import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

export function useSearchPanelHeight(reference: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const panel = reference.current;

    if (panel === null) return;

    const observer = new ResizeObserver(() => setHeight(panel.offsetHeight));

    observer.observe(panel);

    return () => observer.disconnect();
  }, [reference]);

  return height;
}

// A scroll down hides the phone search and chips to give the list room. The action row stays.
export function useHideOnScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  setVisible: (visible: boolean) => void,
): void {
  useEffect(() => {
    const box = scrollRef.current;

    if (box === null) return;

    const mobile = window.matchMedia("(width < 48rem)");
    const readPosition = () => {
      const height = box.clientHeight;
      const end = Math.max(0, box.scrollHeight - height);
      return { top: Math.min(Math.max(box.scrollTop, 0), end), height, end };
    };
    let previous = readPosition();
    const onScroll = (): void => {
      const current = readPosition();

      if (current.top <= 0) {
        setVisible(true);
        previous = current;
        return;
      }

      // Ignore elastic overscroll and position clamps caused by a change to the scroll range.
      if (current.height !== previous.height || current.end !== previous.end) {
        previous = current;
        return;
      }

      if (!mobile.matches) {
        previous = current;
        return;
      }

      const delta = current.top - previous.top;

      if (Math.abs(delta) >= 24) {
        const searchFocused = document.activeElement?.matches('input[type="search"]') ?? false;

        // Keep a focused search field available while its keyboard is open.
        if (delta < 0 || !searchFocused) setVisible(delta < 0);
        previous = current;
      }
    };
    const onBreakpointChange = (): void => {
      previous = readPosition();
      setVisible(true);
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    mobile.addEventListener("change", onBreakpointChange);

    return () => {
      box.removeEventListener("scroll", onScroll);
      mobile.removeEventListener("change", onBreakpointChange);
    };
  }, [scrollRef, setVisible]);
}

// With the keyboard up the library takes only the visible area, so its bar stays above the keyboard.
export function useKeyboardFit(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;

    if (root === null || viewport === null) return;

    const html = document.documentElement;
    let typing = false;
    const fit = (): void => {
      root.style.height = typing ? `${viewport.height}px` : "";

      // iOS scrolls the window. Its viewport offset lags behind and stays stale for a while after the close.
      const shift = typing ? Math.max(window.scrollY, viewport.offsetTop) : window.scrollY;

      root.style.top = shift > 0 ? `${shift}px` : "";
      // The page is no taller than what shows and does not scroll, so iOS has less to move.
      html.style.height = typing ? `${viewport.height}px` : "";
      html.style.overflow = typing ? "hidden" : "";

      // The root's clientHeight stays the full screen with the keyboard up. InnerHeight shrinks with it.
      const covered = html.clientHeight - viewport.height;

      if (typing && covered > 0) {
        try {
          localStorage.setItem("keyboard-height", String(covered));
        } catch {
          // Without storage, the next focus shrinks the column only once the keyboard is up.
        }
      }
    };
    const onFocus = (event: FocusEvent): void => {
      typing = event.type === "focusin" && (event.target as Element).matches("input, textarea");

      const known = (() => {
        try {
          return Number(localStorage.getItem("keyboard-height") ?? 0);
        } catch {
          return 0;
        }
      })();

      // At once while it opens, so iOS sees the field's final place. The close slides with the keyboard.
      root.style.transition = typing ? "none" : "";

      // Shrunk before iOS opens the keyboard, the field is already in view, so iOS does not move the page.
      if (typing && known > 0 && html.clientHeight - viewport.height < 1) {
        root.style.height = `${html.clientHeight - known}px`;
        html.style.height = `${html.clientHeight - known}px`;
        html.style.overflow = "hidden";
      } else {
        fit();
      }
    };

    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onFocus);
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    window.addEventListener("scroll", fit);

    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onFocus);
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [rootRef]);
}
