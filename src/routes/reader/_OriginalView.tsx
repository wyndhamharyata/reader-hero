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
import { forkApp, stopFiber } from "@/lib/hooks";
import { usePinch, type PinchPoint } from "@/lib/use-pinch";
import { useTapFilter } from "@/lib/use-tap-filter";
import { openOriginalPages, readPageSizes, releaseOriginalPages } from "@/use-cases/open-book";
import type { RenderedDocument } from "@/services/page-renderer";
import { PageSearch } from "./_PageSearch";
import { PdfPageList } from "./_PdfPageList";
import { usePageDetails } from "./_use-page-details";

// Long enough that a pause between flicks is not a rest.
const TEXT_SETTLE_MS = 150;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const NO_PAGES: ReadonlySet<number> = new Set();

interface Props {
  bookId: string;
  pageCount: number;
  initialPage: number;
  showChrome: boolean;
  // A Contents entry's page. The nonce lets the same entry go again.
  jump: { readonly page: number; readonly nonce: number } | null;
  // Null for a scanned book, which has no text to search.
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }> | null;
  // The words from Contents' search. Null shows no find bar.
  pageQuery: string | null;
  onCloseSearch: () => void;
  onPageChange: (page: number) => void;
  onToggleChrome: () => void;
}

export function OriginalView({
  bookId,
  pageCount,
  initialPage,
  showChrome,
  jump,
  blocks,
  pageQuery,
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
  const ratio = globalThis.devicePixelRatio || 1;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setScroller(element);
  }, []);
  const measureRef = useRef<HTMLDivElement>(null);
  const tap = useTapFilter();
  const listRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<RenderedDocument | null>(null);
  const didScroll = useRef(false);
  const isSearching = pageQuery !== null && blocks !== null;

  useEffect(() => {
    const markFailed = () => Effect.sync(() => setFailed(true));
    const program = openOriginalPages(bookId).pipe(
      Effect.flatMap((opened) =>
        Effect.gen(function* () {
          documentRef.current = opened;
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
      const opened = documentRef.current;

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
    // A render in the scroll event competes with the scroll.
    useFlushSync: false,
    // From each page's own size. Each drawn page is then measured, so a wrong guess cannot leave a blank space.
    estimateSize: (index) => {
      const size = sizes[index];
      return size === undefined ? 0 : (pageWidth * size.height) / size.width;
    },
    gap: 12,
    paddingStart: 8,
    // A page the search goes to starts below the search bar, not under it.
    scrollPaddingStart: isSearching ? 64 : 0,
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
  const { details, placeDetails, resetDetails } = usePageDetails({
    containerRef,
    listRef,
    virtualizer,
    zoom,
    width,
    pageWidth,
    sizes,
  });

  // Each page on screen gets its text once scrolling rests, so a fling builds none along the way.
  const [textPages, setTextPages] = useState<ReadonlySet<number>>(NO_PAGES);
  const textPagesRef = useRef<ReadonlySet<number>>(NO_PAGES);
  const textReady = useRef(new Set<number>());
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showText = useCallback((pages: ReadonlySet<number>) => {
    const was = textPagesRef.current;

    if (pages.size === was.size && [...pages].every((page) => was.has(page))) return;

    textPagesRef.current = pages;
    for (const page of textReady.current) if (!pages.has(page)) textReady.current.delete(page);
    setTextPages(pages);
  }, []);
  const onTextReady = useCallback((page: number) => {
    if (textPagesRef.current.has(page)) textReady.current.add(page);
  }, []);
  const pagesOnScreen = useCallback((): ReadonlySet<number> => {
    const container = containerRef.current;

    if (container === null) return NO_PAGES;

    const top = container.scrollTop;
    const bottom = top + container.clientHeight;
    const pages = new Set<number>();

    for (const item of virtualizer.getVirtualItems()) {
      if (item.end > top && item.start < bottom) pages.add(item.index + 1);
    }

    return pages;
  }, [virtualizer]);
  const waitToSettle = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      showText(pagesOnScreen());
      placeDetails();
    }, TEXT_SETTLE_MS);
  }, [showText, pagesOnScreen, placeDetails]);
  // A scroll stops builds in progress. Finished layers stay.
  const onScroll = useCallback(() => {
    waitToSettle();

    const pages = textPagesRef.current;

    if (pages.size === textReady.current.size) return;

    showText(new Set([...pages].filter((page) => textReady.current.has(page))));
  }, [waitToSettle, showText]);

  useEffect(() => {
    if (doc === null) return;

    waitToSettle();

    return () => clearTimeout(settle.current);
  }, [doc, waitToSettle]);

  // A pinch moves only the list's transform. The zoom changes once, when it ends.
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
      resetDetails();
      setZoom(next);
    },
    onCancel: () => {
      gesture.current = null;
      if (listRef.current !== null) listRef.current.style.transform = "";
    },
    clamp: (scale) => clampZoom(zoom * scale) / zoom,
  });

  // Stable, so a link's jump does not re-render every memoised page.
  const jumpTo = useCallback(
    (page: number) => virtualizer.scrollToIndex(page - 1, { align: "start" }),
    [virtualizer],
  );

  // After the open, as no page can be scrolled to before the list has its pages.
  useEffect(() => {
    if (jump !== null && doc !== null) jumpTo(jump.page);
  }, [jump, doc, jumpTo]);

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

    list.style.transform = "";
    virtualizer.measure();
    // The new height goes in first, as the old one would cut the scroll below short.
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
    // Only a real move, as writing scrollTop on iOS stops a fling. Size batches arrive while one runs.
    const target = moved === undefined ? null : moved.start + part * moved.size;

    if (target !== null && Math.abs(target - container.scrollTop) >= 1)
      container.scrollTop = target;
  }, [virtualizer, sizes, width, pageWidth, waitToSettle]);

  return (
    <div className="relative h-full">
      {failed && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-(--ink-soft)">The original pages could not be read.</p>
          <SlideLink to="/" direction="out" className="key small">
            Back to library
          </SlideLink>
        </div>
      )}

      {doc === null && !failed && <div className="h-full" />}

      {doc !== null && (
        <div
          ref={attachScroller}
          data-scroller
          className="h-full [touch-action:pan-x_pan-y] overflow-auto overscroll-contain bg-(--sunk) [background-image:var(--grain)]"
          onPointerDown={tap.onPointerDown}
          onScroll={onScroll}
          onClick={(event) => {
            if (tap.isTap(event)) onToggleChrome();
          }}
        >
          {/* The column's width at no zoom; the list's own grows with it. */}
          <div aria-hidden className="mx-auto h-0 max-w-3xl px-4">
            <div ref={measureRef} />
          </div>
          {/* The sides are padding on the column, so a page is exactly as wide as the list. */}
          <div
            className="mx-auto max-w-3xl px-4 pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+7rem)]"
            style={
              zoom === MIN_ZOOM
                ? undefined
                : { width: `calc(${pageWidth}px + 1rem)`, maxWidth: "none" }
            }
          >
            <PdfPageList
              virtualizer={virtualizer}
              listRef={listRef}
              sizes={sizes}
              doc={doc}
              pageWidth={pageWidth}
              width={width}
              ratio={ratio}
              textPages={textPages}
              query={query}
              details={details}
              onTextReady={onTextReady}
              onJump={jumpTo}
            />
          </div>
        </div>
      )}

      {doc !== null && pageQuery !== null && blocks !== null && (
        <PageSearch
          doc={doc}
          blocks={blocks}
          initialQuery={pageQuery}
          currentPage={current}
          onGo={jumpTo}
          onQuery={setQuery}
          onClose={onCloseSearch}
        />
      )}

      {doc !== null && !showChrome && !isSearching && (
        <span className="page-badge">
          Page {current} of {pageCount}
        </span>
      )}
    </div>
  );
}
