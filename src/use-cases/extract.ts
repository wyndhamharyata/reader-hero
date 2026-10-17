import { Effect, Stream } from "effect";
import type { PageText, ParsedBook } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
  // What `page` counts. A PDF counts pages, an EPUB counts chapters and then images.
  readonly step?: "Chapter" | "Image";
  readonly file?: { readonly index: number; readonly count: number; readonly name: string };
}

export interface PageRead extends ParseProgress {
  readonly text: PageText;
  readonly failed?: boolean;
}

export interface ExtractResult {
  readonly parsed: ParsedBook;
  readonly scanned: boolean;
}

const READ_CONCURRENCY = 2;

const countChars = (text: PageText): number =>
  text.items.reduce((sum, item) => sum + item.str.length, 0);

export function extractPages(handle: PdfHandle): Stream.Stream<PageRead, PdfFailure, PdfClient> {
  return Stream.unwrap(
    Effect.map(PdfClient, (pdf) => {
      const total = pdf.pageCount(handle);
      return Stream.range(1, total).pipe(
        // A damaged PDF often opens and then fails on a page or two. Those read as empty, not as a failed book.
        Stream.mapEffect(
          (page) =>
            pdf.readPage(handle, page).pipe(
              Effect.map((text): PageRead => ({ page, total, text })),
              Effect.orElseSucceed((): PageRead => ({
                page,
                total,
                text: { page, width: 0, height: 0, items: [] },
                failed: true,
              })),
            ),
          { concurrency: READ_CONCURRENCY },
        ),
      );
    }),
  );
}

export function assembleExtract(
  handle: PdfHandle,
  pages: ReadonlyArray<PageRead>,
): Effect.Effect<ExtractResult, PdfFailure, PdfClient> {
  return Effect.gen(function* () {
    const pdf = yield* PdfClient;
    const total = pdf.pageCount(handle);

    // Most pages unreadable is a broken file, which must not pass for a scanned book.
    if (pages.filter((page) => page.failed === true).length * 2 > total) {
      return yield* new PdfFailure({ reason: "corrupt", message: "Most pages could not be read" });
    }

    const outline = yield* pdf.readOutline(handle);
    const texts = pages.map((page) => page.text);
    const charCount = texts.reduce((sum, text) => sum + countChars(text), 0);
    const scanned = isScanned(charCount, total);
    const parsed = yield* assembleBook(
      texts.map((text) => ({ text, images: [] })),
      outline,
    );

    return { parsed, scanned };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
