import { useVirtualizer } from "@tanstack/react-virtual";
import { Effect, Stream } from "effect";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { SlideLink } from "@/components/SlideLink";
import type { PageSize } from "@/domain/book";
import { pageBadge } from "@/lib/badges";
import { forkApp, stopFiber } from "@/lib/hooks";
import { slideReady } from "@/lib/slide-to";
import { openOriginalPages, readPageSizes, releaseOriginalPages } from "@/use-cases/open-book";
import type { RenderedDocument } from "@/services/page-renderer";
import { PdfPage } from "./_PdfPage";

interface Props {
  bookId: string;
  pageCount: number;
  initialPage: number;
  showChrome: boolean;
  onPageChange: (page: number) => void;
  onToggleChrome: () => void;
}

export function OriginalView({
  bookId,
  pageCount,
  initialPage,
  showChrome,
  onPageChange,
  onToggleChrome,
}: Props): ReactElement {
  const [doc, setDoc] = useState<RenderedDocument | null>(null);
  const [sizes, setSizes] = useState<ReadonlyArray<PageSize>>([]);
  const [current, setCurrent] = useState(initialPage);
  const [failed, setFailed] = useState(false);
  // The page column's width: the scroll box less its 8px sides, at most max-w-3xl.
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => setWidth(Math.min(container.clientWidth, 768) - 16));
    observer.observe(container);
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
      return size === undefined ? 0 : (width * size.height) / size.width;
    },
    gap: 12,
    paddingStart: 8,
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
    virtualizer.measure();
    // The new height goes in now: the old one would cut the scroll below short.
    list.style.height = `${virtualizer.getTotalSize()}px`;
    if (width === 0 || sizes.length === 0) return;
    if (!didScroll.current) {
      didScroll.current = true;
      virtualizer.scrollToIndex(startPage.current - 1, { align: "start" });
      return;
    }
    const moved = held === undefined ? undefined : virtualizer.measurementsCache[held.index];
    if (moved !== undefined) container.scrollTop = moved.start + part * moved.size;
  }, [virtualizer, sizes, width]);

  // An opening book shows once its page is placed and painted, or once it fails to open.
  useEffect(() => {
    const container = containerRef.current;
    if (failed) slideReady();
    if (container === null || doc === null) return;
    let active = true;
    const wait = async (): Promise<void> => {
      for (;;) {
        const page = container.querySelector(`[data-page="${startPage.current}"]`);
        if (didScroll.current && page?.querySelector("canvas:not([data-painted])") === null) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!active) return;
      }
      slideReady();
    };
    void wait();
    return () => {
      active = false;
    };
  }, [doc, failed]);

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
          ref={containerRef}
          data-scroller
          className="h-full overflow-y-auto overscroll-contain bg-base-300"
          onClick={onToggleChrome}
        >
          <div className="pb-[var(--safe-bottom)]">
            <div
              ref={listRef}
              className="relative mx-auto max-w-3xl"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const size = sizes[item.index];
                return (
                  size !== undefined && (
                    <div
                      key={item.key}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      className="absolute inset-x-2 top-0"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <PdfPage doc={doc} size={size} />
                    </div>
                  )
                );
              })}
            </div>
          </div>
        </div>
      )}

      {doc !== null && showChrome && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          <span className={pageBadge}>
            Page {current} of {pageCount}
          </span>
        </div>
      )}
    </div>
  );
}
