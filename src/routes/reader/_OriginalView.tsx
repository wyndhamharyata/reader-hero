import { Effect, Stream } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { SlideLink } from "@/components/SlideLink";
import type { PageSize } from "@/domain/book";
import { pageBadge } from "@/lib/badges";
import { forkApp, stopFiber } from "@/lib/hooks";
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
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const [current, setCurrent] = useState(initialPage);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<RenderedDocument | null>(null);
  const didScroll = useRef(false);

  useEffect(() => {
    const markFailed = () => Effect.sync(() => setFailed(true));
    const program = openOriginalPages(bookId).pipe(
      Effect.flatMap((opened) =>
        Effect.gen(function* () {
          docRef.current = opened;
          setDoc(opened);
          // The page being read paints at once, before the observer reports what is in view.
          setVisible(new Set([initialPage]));
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
    if (didScroll.current || sizes.length === 0) return;
    const container = containerRef.current;
    if (container === null) return;
    didScroll.current = true;
    container
      .querySelector<HTMLElement>(`[data-page="${initialPage}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [sizes, initialPage]);

  // One observer for every page: which pages to paint (with a margin, so a page is ready before it
  // scrolls in) and which page is at the centre.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || sizes.length === 0) return;
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>("[data-page]"));
    const painter = new IntersectionObserver(
      (entries) => {
        setVisible((known) => {
          const next = new Set(known);
          for (const entry of entries) {
            const page = Number(entry.target.getAttribute("data-page"));
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root: container, rootMargin: "600px 0px" },
    );
    const tracker = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.getAttribute("data-page")));
        if (seen.length === 0) return;
        const page = Math.min(...seen);
        setCurrent(page);
        onPageChange(page);
      },
      { root: container, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const wrapper of wrappers) {
      painter.observe(wrapper);
      tracker.observe(wrapper);
    }
    return () => {
      painter.disconnect();
      tracker.disconnect();
    };
  }, [sizes.length, onPageChange]);

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
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-2 pb-[calc(0.5rem+var(--safe-bottom))]">
            {sizes.map((size) => (
              <PdfPage key={size.page} doc={doc} size={size} visible={visible.has(size.page)} />
            ))}
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
