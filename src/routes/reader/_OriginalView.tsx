import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { PageSize } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { pageBadge } from "@/lib/badges";
import { forkApp, stopFiber } from "@/lib/hooks";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { PdfPage } from "./_PdfPage";

interface Props {
  bookId: string;
  pageCount: number;
  initialPage: number;
  showChrome: boolean;
  onPageChange: (page: number) => void;
}

export function OriginalView({ bookId, pageCount, initialPage, showChrome, onPageChange }: Props) {
  const [handle, setHandle] = useState<PdfHandle | null>(null);
  const [sizes, setSizes] = useState<ReadonlyArray<PageSize>>([]);
  const [current, setCurrent] = useState(initialPage);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<PdfHandle | null>(null);
  const didScroll = useRef(false);

  useEffect(() => {
    const markFailed = () => Effect.sync(() => setFailed(true));
    const program = Effect.gen(function* () {
      const store = yield* BookStore;
      const pdf = yield* PdfClient;
      const blob = yield* store.getFile(bookId);
      const data = yield* Effect.tryPromise({
        try: () => blob.arrayBuffer(),
        catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
      });
      const loaded = yield* pdf.load(data);
      const pageSizes = yield* pdf.pageSizes(loaded);
      return { loaded, pageSizes };
    }).pipe(
      Effect.tap(({ loaded, pageSizes }) =>
        Effect.sync(() => {
          handleRef.current = loaded;
          setHandle(loaded);
          setSizes(pageSizes);
        }),
      ),
      Effect.catchTags({
        BookNotFound: markFailed,
        PdfFailure: markFailed,
        StorageFailure: markFailed,
      }),
    );

    const fiber = forkApp(program);
    return () => stopFiber(fiber);
  }, [bookId]);

  useEffect(() => {
    return () => {
      const loaded = handleRef.current;
      if (loaded === null) return;
      void forkApp(Effect.flatMap(PdfClient, (pdf) => pdf.release(loaded)));
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

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || sizes.length === 0) return;
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>("[data-page]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.getAttribute("data-page")));
        if (visible.length === 0) return;
        const page = Math.min(...visible);
        setCurrent(page);
        onPageChange(page);
      },
      { root: container, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    wrappers.forEach((wrapper) => observer.observe(wrapper));
    return () => observer.disconnect();
  }, [sizes, onPageChange]);

  return (
    <div className="relative h-full">
      {failed && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="opacity-80">The original pages could not be read.</p>
          <Link to="/" className="btn btn-ghost btn-sm">
            Back to library
          </Link>
        </div>
      )}

      {handle === null && !failed && (
        <div className="flex h-full items-center justify-center">
          <span className="loading loading-spinner" />
        </div>
      )}

      {handle !== null && (
        <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain bg-base-300">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-2">
            {sizes.map((size) => (
              <PdfPage key={size.page} handle={handle} size={size} root={containerRef} />
            ))}
          </div>
        </div>
      )}

      {handle !== null && showChrome && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          <span className={pageBadge}>
            Page {current} of {pageCount}
          </span>
        </div>
      )}
    </div>
  );
}
