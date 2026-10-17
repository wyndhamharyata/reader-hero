import { Effect, Stream } from "effect";
import type { PageSize } from "@/domain/book";
import type { BookNotFound, PdfFailure, StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { PageRenderer, type RenderedDocument } from "@/services/page-renderer";

export function openOriginalPages(
  bookId: string,
): Effect.Effect<
  RenderedDocument,
  BookNotFound | StorageFailure | PdfFailure,
  BookStore | PageRenderer
> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const renderer = yield* PageRenderer;

    // User Timing marks that Safari's Timelines tab shows and scripts/bench reads.
    performance.mark("reader-hero:open-start");
    const blob = yield* store.getFile(bookId);
    performance.mark("reader-hero:file-read");
    const rendered = yield* renderer.open(blob);
    performance.mark("reader-hero:document-open");
    performance.measure("reader-hero:file", "reader-hero:open-start", "reader-hero:file-read");
    performance.measure(
      "reader-hero:document",
      "reader-hero:file-read",
      "reader-hero:document-open",
    );
    return rendered;
  });
}

// The remaining sizes arrive in batches, so the view does not wait on every page before it paints.
export function readPageSizes(
  rendered: RenderedDocument,
  from: number,
): Stream.Stream<ReadonlyArray<PageSize>, never, PageRenderer> {
  return Stream.unwrap(
    Effect.map(PageRenderer, (renderer) =>
      Stream.range(from, rendered.pageCount).pipe(
        Stream.mapEffect(
          (page) =>
            renderer
              .pageSize(rendered, page)
              .pipe(Effect.orElseSucceed((): PageSize | null => null)),
          { concurrency: 4 },
        ),
        Stream.filter((size): size is PageSize => size !== null),
        Stream.grouped(20),
      ),
    ),
  );
}

export function releaseOriginalPages(
  rendered: RenderedDocument,
): Effect.Effect<void, never, PageRenderer> {
  return Effect.flatMap(PageRenderer, (renderer) => renderer.close(rendered));
}
