import type { Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PageSize } from "@/domain/book";
import { pageRenderScale } from "@/lib/render-scale";
import type { PageArea } from "@/use-cases/render-page";

// pdf.js's own cap for one canvas on iOS and Android.
const DETAIL_PIXELS = 5_242_880;
// Past each edge of the screen, so a short pan stays sharp.
const DETAIL_MARGINS = [0.5, 0.25, 0];
const MIN_ZOOM = 1;

type Detail = { readonly scale: number; readonly area: PageArea };
const NO_DETAILS: ReadonlyMap<number, Detail> = new Map();

export function usePageDetails({
  containerRef,
  listRef,
  virtualizer,
  zoom,
  width,
  pageWidth,
  sizes,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  readonly zoom: number;
  readonly width: number;
  readonly pageWidth: number;
  readonly sizes: ReadonlyArray<PageSize>;
}): {
  readonly details: ReadonlyMap<number, Detail>;
  readonly placeDetails: () => void;
  readonly resetDetails: () => void;
} {
  const [details, setDetails] = useState(NO_DETAILS);
  // Values when scrolling rests, not those of the render that set the timer.
  const latest = useRef({ zoom, width, pageWidth, sizes });

  useEffect(() => {
    latest.current = { zoom, width, pageWidth, sizes };
  });

  // One sharp area per page on screen, as pdf.js's detail view.
  const placeDetails = useCallback(() => {
    const container = containerRef.current;
    const list = listRef.current;
    const { zoom: zoomed, pageWidth: shownWidth, sizes: known } = latest.current;

    if (container === null || list === null || zoomed <= MIN_ZOOM) {
      setDetails(NO_DETAILS);
      return;
    }

    const ratio = globalThis.devicePixelRatio || 1;
    const listLeft =
      list.getBoundingClientRect().left -
      container.getBoundingClientRect().left +
      container.scrollLeft;
    const view = {
      left: container.scrollLeft - listLeft,
      top: container.scrollTop,
      width: container.clientWidth,
      height: container.clientHeight,
    };
    const next = new Map<number, Detail>();
    const visible = new Map<number, PageArea>();

    for (const item of virtualizer.getVirtualItems()) {
      const size = known[item.index];

      if (size === undefined || item.size === 0) continue;

      const cssPerPoint = shownWidth / size.width;
      const top = Math.max(view.top, item.start);
      const bottom = Math.min(view.top + view.height, item.end);
      const left = Math.max(0, view.left);
      const right = Math.min(shownWidth, view.left + view.width);

      if (bottom <= top || right <= left) continue;

      let scale = cssPerPoint * ratio;

      if (scale <= pageRenderScale(size, latest.current.width, ratio) * 1.15) continue;

      let area = { left, top: top - item.start, width: right - left, height: bottom - top };

      visible.set(size.page, {
        left: area.left / shownWidth,
        top: area.top / item.size,
        width: area.width / shownWidth,
        height: area.height / item.size,
      });

      for (const margin of DETAIL_MARGINS) {
        const x = Math.max(0, left - margin * view.width);
        const y = Math.max(0, top - item.start - margin * view.height);
        const grown = {
          left: x,
          top: y,
          width: Math.min(shownWidth, right + margin * view.width) - x,
          height: Math.min(item.size, bottom - item.start + margin * view.height) - y,
        };

        area = grown;
        if (grown.width * grown.height * ratio * ratio <= DETAIL_PIXELS) break;
      }

      const pixels = area.width * area.height * ratio * ratio;

      if (pixels > DETAIL_PIXELS) scale *= Math.sqrt(DETAIL_PIXELS / pixels);

      const share = (value: number, of: number) => Math.round((value / of) * 10_000) / 10_000;

      next.set(size.page, {
        scale: Math.round(scale * 1000) / 1000,
        area: {
          left: share(area.left, shownWidth),
          top: share(area.top, item.size),
          width: share(area.width, shownWidth),
          height: share(area.height, item.size),
        },
      });
    }

    // An area drawn at this scale that still covers the screen stays, so a short pan draws nothing again.
    setDetails((previous) => {
      const kept = new Map<number, Detail>();

      for (const [page, detail] of next) {
        const old = previous.get(page);
        const shown = visible.get(page);
        const covers =
          old !== undefined &&
          shown !== undefined &&
          old.scale === detail.scale &&
          old.area.left <= shown.left &&
          old.area.top <= shown.top &&
          old.area.left + old.area.width >= shown.left + shown.width &&
          old.area.top + old.area.height >= shown.top + shown.height;

        kept.set(page, covers ? old : detail);
      }

      const same =
        kept.size === previous.size &&
        [...kept].every(([page, detail]) => previous.get(page) === detail);

      return same ? previous : kept;
    });
  }, [containerRef, listRef, virtualizer]);

  const resetDetails = useCallback(() => setDetails(NO_DETAILS), []);

  return { details, placeDetails, resetDetails };
}
