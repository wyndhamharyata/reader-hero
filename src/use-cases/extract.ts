import { Effect, Stream } from "effect";
import type { PageText, ParsedBook } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
  // What `page` counts; a PDF counts pages, an EPUB counts chapters and then images.
  readonly step?: "Chapter" | "Image";
  readonly file?: { readonly index: number; readonly count: number; readonly name: string };
}

export interface PageRead extends ParseProgress {
  readonly text: PageText;
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
        Stream.mapEffect(
          (page) => Effect.map(pdf.readPage(handle, page), (text) => ({ page, total, text })),
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
    const outline = yield* pdf.readOutline(handle);
    const texts = pages.map((page) => page.text);
    const charCount = texts.reduce((sum, text) => sum + countChars(text), 0);
    const scanned = isScanned(charCount, total);
    const parsed = assembleBook(
      texts.map((text) => ({ text, images: [] })),
      outline,
    );
    return { parsed, scanned };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
