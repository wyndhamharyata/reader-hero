import { useVirtualizer } from "@tanstack/react-virtual";
import { Effect, Stream } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { SlideLink } from "@/components/SlideLink";
import type { PageSize } from "@/domain/book";
import { pageBadge } from "@/lib/badges";
import { forkApp, stopFiber } from "@/lib/hooks";
import { usePinch, type PinchPoint } from "@/lib/use-pinch";
import { useTapGuard } from "@/lib/use-tap-guard";
import { openOriginalPages, readPageSizes, releaseOriginalPages } from "@/use-cases/open-book";
import type { RenderedDocument } from "@/services/page-renderer";
import type { PageArea } from "@/use-cases/render-page";
import { PageSearch } from "./_PageSearch";
import { PdfPage, RENDER_SCALE } from "./_PdfPage";

// Long enough that a pause between flicks is not a rest.
const TEXT_SETTLE_MS = 150;

// Fit to width is the least; past 4x a phone shows a few words at a time.
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
// pdf.js's own cap for one canvas on iOS and Android.
const DETAIL_PIXELS = 5_242_880;
// The sharp area reaches this share of the screen past each edge, so a short pan stays sharp.
const DETAIL_MARGINS = [0.5, 0.25, 0];

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Detail = { readonly scale: number; readonly area: PageArea };
const NO_DETAILS: ReadonlyMap<number, Detail> = new Map();

interface Props {
  bookId: string;
  pageCount: number;
  initialPage: number;
  showChrome: boolean;
  // The parsed text, which the search goes through; null hides the search, as for a scanned book.
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }> | null;
  searching: boolean;
  onCloseSearch: () => void;
  onPageChange: (page: number) => void;
  onToggleChrome: () => void;
}

export function OriginalView({
  bookId,
  pageCount,
  initialPage,
  showChrome,
  blocks,
  searching,
  onCloseSearch,
  onPageChange,
  onToggleChrome,
}: Props): ReactElement {
  const [doc, setDoc] = useState<RenderedDocument | null>(null);
  const [sizes, setSizes] = useState<ReadonlyArray<PageSize>>([]);
  const [current, setCurrent] = useState(initialPage);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  // The column's width, which a page fills at no zoom.
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const pageWidth = width * zoom;
  const [details, setDetails] = useState(NO_DETAILS);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setScroller(element);
  }, []);
  const measureRef = useRef<HTMLDivElement>(null);
  const tap = useTapGuard();
  const listRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<RenderedDocument | null>(null);
  const didScroll = useRef(false);

  useEffect(() => {
    const markFailed = () => Effect.sync(() => setFailed(true));
    const program = openOriginalPages(bookId).pipe(
      Effect.flatMap((opened) =>
        Effect.gen(function* () {
          docRef.current = opened;
          setDoc(opened);
          // Every page takes the first page's size until its own arrives, so the first page paints at once.
          setSizes(
            Array.from({ length: opened.pageCount }, (_, index) => ({
              ...opened.first,
              page: index + 1,
            })),
          );
          yield* readPageSizes(opened, 2).pipe(
            Stream.runForEach((batch) =>
              Effect.sync(() =>
                setSizes((known) => {
                  const next = [...known];
                  for (const size of batch) next[size.page - 1] = size;
                  return next;
                }),
              ),
            ),
          );
        }),
      ),
      Effect.catchTags({
        BookNotFound: markFailed,
        StorageFailure: markFailed,
        PdfFailure: markFailed,
      }),
    );
    const fiber = forkApp(program);
    return () => stopFiber(fiber);
  }, [bookId]);

  useEffect(() => {
    return () => {
      const opened = docRef.current;
      if (opened === null) return;
      void forkApp(releaseOriginalPages(opened));
    };
  }, []);

  // Read from the column, not worked out: max-w-3xl is 48rem, so its pixels follow the font size.
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (measure === null) return;
    // Before paint as well, so the first frame is already at the saved page.
    setWidth(measure.clientWidth);
    const observer = new ResizeObserver(() => setWidth(measure.clientWidth));
    observer.observe(measure);
    return () => observer.disconnect();
  }, [doc]);

  // Only the pages near the screen are in the page, each with a canvas only while it is there.
  const shown = useRef(initialPage);
  const virtualizer = useVirtualizer({
    count: sizes.length,
    getScrollElement: () => containerRef.current,
    // From each page's own size; each drawn page is then measured, so a wrong guess cannot leave a gap.
    estimateSize: (index) => {
      const size = sizes[index];
      return size === undefined ? 0 : (pageWidth * size.height) / size.width;
    },
    gap: 12,
    paddingStart: 8,
    // A page the search goes to starts below the search bar, not under it.
    scrollPaddingStart: searching ? 64 : 0,
    // Two pages each side are drawn before they scroll in.
    overscan: 2,
    // The page at the middle of the screen is the one being read.
    onChange: (instance) => {
      const middle = (instance.scrollOffset ?? 0) + (instance.scrollRect?.height ?? 0) / 2;
      const page = (instance.getVirtualItemForOffset(middle)?.index ?? -1) + 1;
      if (page === 0 || page === shown.current) return;
      shown.current = page;
      setCurrent(page);
      onPageChange(page);
    },
  });
  // The page being read gets its text once scrolling rests, so a fling builds none along the way.
  const [textPage, setTextPage] = useState<number | null>(null);
  const textPageRef = useRef<number | null>(null);
  const textReady = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showText = useCallback((page: number | null) => {
    if (textPageRef.current === page) return;
    textPageRef.current = page;
    textReady.current = null;
    setTextPage(page);
  }, []);
  const onTextReady = useCallback((page: number) => {
    if (textPageRef.current === page) textReady.current = page;
  }, []);
  // Read when scrolling rests, from the values of that moment, not of the render that set the timer.
  const latest = useRef({ zoom, pageWidth, sizes });
  useEffect(() => {
    latest.current = { zoom, pageWidth, sizes };
  });
  // At a zoom past what the whole-page bitmaps hold, each page on screen gets one sharp area, as pdf.js's detail view.
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
      // No sharper than the whole-page bitmap already is, so no area is worth drawing.
      if (scale <= RENDER_SCALE * 1.15) continue;
      let area = { left, top: top - item.start, width: right - left, height: bottom - top };
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
    setDetails(next);
  }, [virtualizer]);
  const waitToSettle = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      showText(shown.current);
      placeDetails();
    }, TEXT_SETTLE_MS);
  }, [showText, placeDetails]);
  // A scroll that starts while the text is still being built stops it; a finished layer stays until the next rest.
  const onScroll = useCallback(() => {
    waitToSettle();
    if (textPageRef.current !== null && textReady.current !== textPageRef.current) showText(null);
  }, [waitToSettle, showText]);
  useEffect(() => {
    if (doc === null) return;
    waitToSettle();
    return () => clearTimeout(settle.current);
  }, [doc, waitToSettle]);

  // During a pinch only the list's transform changes; the zoom, and with it every page's layout, changes once at the end.
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const anchor = useRef<{
    index: number;
    down: number;
    across: number;
    at: PinchPoint;
  } | null>(null);
  const pinchOrigin = (start: PinchPoint) => {
    const container = containerRef.current;
    const list = listRef.current;
    if (container === null || list === null) return null;
    if (gesture.current === null) {
      const listBox = list.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      gesture.current = {
        x: start.x + box.left - listBox.left,
        y: start.y + box.top - listBox.top,
      };
    }
    return { list, origin: gesture.current };
  };
  usePinch(scroller, {
    onPreview: (scale, start, now) => {
      const pinch = pinchOrigin(start);
      if (pinch === null) return;
      const shownScale = clampZoom(zoom * scale) / zoom;
      pinch.list.style.transformOrigin = `${pinch.origin.x}px ${pinch.origin.y}px`;
      pinch.list.style.transform = `translate(${now.x - start.x}px, ${now.y - start.y}px) scale(${shownScale})`;
    },
    onEnd: (scale, start, now) => {
      const pinch = pinchOrigin(start);
      gesture.current = null;
      if (pinch === null) return;
      const next = clampZoom(zoom * scale);
      const item = virtualizer.getVirtualItemForOffset(pinch.origin.y);
      if (Math.abs(next - zoom) < 0.01 || item === undefined || item.size === 0) {
        pinch.list.style.transform = "";
        return;
      }
      // The point under the fingers when they met stays under them where they let go.
      anchor.current = {
        index: item.index,
        down: (pinch.origin.y - item.start) / item.size,
        across: pageWidth === 0 ? 0 : pinch.origin.x / pageWidth,
        at: now,
      };
      setDetails(NO_DETAILS);
      setZoom(next);
    },
  });

  // Stable, so a link's jump does not re-render every memoised page.
  const jumpTo = useCallback(
    (page: number) => virtualizer.scrollToIndex(page - 1, { align: "start" }),
    [virtualizer],
  );

  // New sizes or width change every page's height: first the view goes to the saved page, then the page being read stays.
  const startPage = useRef(initialPage);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (container === null || list === null) return;
    const held = didScroll.current
      ? virtualizer.getVirtualItemForOffset(container.scrollTop)
      : undefined;
    const part =
      held === undefined || held.size === 0 ? 0 : (container.scrollTop - held.start) / held.size;
    // The pinch's transform goes in the same frame as the zoom it stood for.
    list.style.transform = "";
    virtualizer.measure();
    // The new height goes in now: the old one would cut the scroll below short.
    list.style.height = `${virtualizer.getTotalSize()}px`;
    if (width === 0 || sizes.length === 0) return;
    const pinched = anchor.current;
    anchor.current = null;
    if (pinched !== null) {
      const item = virtualizer.measurementsCache[pinched.index];
      if (item !== undefined)
        container.scrollTop = item.start + pinched.down * item.size - pinched.at.y;
      const listLeft =
        list.getBoundingClientRect().left -
        container.getBoundingClientRect().left +
        container.scrollLeft;
      container.scrollLeft = listLeft + pinched.across * pageWidth - pinched.at.x;
      waitToSettle();
      return;
    }
    if (!didScroll.current) {
      didScroll.current = true;
      virtualizer.scrollToIndex(startPage.current - 1, { align: "start" });
      return;
    }
    const moved = held === undefined ? undefined : virtualizer.measurementsCache[held.index];
    if (moved !== undefined) container.scrollTop = moved.start + part * moved.size;
  }, [virtualizer, sizes, width, pageWidth, waitToSettle]);

  return (
    <div className="relative h-full">
      {failed && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="opacity-80">The original pages could not be read.</p>
          <SlideLink to="/" direction="out" className="btn btn-ghost btn-sm">
            Back to library
          </SlideLink>
        </div>
      )}

      {doc === null && !failed && (
        <div className="flex h-full items-center justify-center">
          <span className="loading loading-spinner" />
        </div>
      )}

      {doc !== null && (
        <div
          ref={attachScroller}
          data-scroller
          className="h-full [touch-action:pan-x_pan-y] overflow-auto overscroll-contain bg-base-300"
          onPointerDown={tap.onPointerDown}
          onScroll={onScroll}
          onClick={(event) => {
            if (tap.isTap(event)) onToggleChrome();
          }}
        >
          {/* The column's width at no zoom, read here as the list's own grows with the zoom. */}
          <div aria-hidden className="mx-auto h-0 max-w-3xl px-2">
            <div ref={measureRef} />
          </div>
          {/* The sides are padding on the column, so a page is exactly as wide as the list. */}
          <div
            className="mx-auto max-w-3xl px-2 pb-[var(--safe-bottom)]"
            style={
              zoom === MIN_ZOOM
                ? undefined
                : { width: `calc(${pageWidth}px + 1rem)`, maxWidth: "none" }
            }
          >
            <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const size = sizes[item.index];
                return (
                  size !== undefined && (
                    <div
                      key={item.key}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      className="absolute inset-x-0 top-0"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <PdfPage
                        doc={doc}
                        size={size}
                        scale={pageWidth / size.width}
                        text={textPage === size.page}
                        query={textPage === size.page ? query : ""}
                        detail={details.get(size.page) ?? null}
                        onTextReady={onTextReady}
                        onJump={jumpTo}
                      />
                    </div>
                  )
                );
              })}
            </div>
          </div>
        </div>
      )}

      {doc !== null && searching && blocks !== null && (
        <PageSearch
          blocks={blocks}
          currentPage={current}
          onGo={jumpTo}
          onQuery={setQuery}
          onClose={onCloseSearch}
        />
      )}

      {doc !== null && showChrome && !searching && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          <span className={pageBadge}>
            Page {current} of {pageCount}
          </span>
        </div>
      )}
    </div>
  );
}
