import { Effect, Stream } from "effect";
import type { PageText, ParsedBook } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { record, timed } from "@/lib/perf";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
}

export interface ExtractResult {
  readonly parsed: ParsedBook;
  readonly scanned: boolean;
}

const READ_CONCURRENCY = 2;

const countChars = (text: PageText): number =>
  text.items.reduce((sum, item) => sum + item.str.length, 0);

/**
 * Reads text only, so the reflowed book is ready fast. Figure placement
 * detection is deliberately left out: `getOperatorList` decodes every image,
 * which is the expensive part of parsing. `renderFigures` does that in the
 * background and then re-assembles the book with image blocks.
 */
export function extractBook(
  handle: PdfHandle,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<ExtractResult, PdfFailure, PdfClient> {
  return Effect.gen(function* () {
    const pdf = yield* PdfClient;
    const total = pdf.pageCount(handle);
    const started = performance.now();

    const texts = yield* Stream.range(1, total).pipe(
      Stream.mapEffect(
        (page) =>
          timed("parse.text", pdf.readPage(handle, page), () => `p${page}`).pipe(
            Effect.tap(() => Effect.sync(() => onProgress({ page, total }))),
          ),
        { concurrency: READ_CONCURRENCY },
      ),
      Stream.runCollect,
    );

    const outline = yield* pdf.readOutline(handle);
    const rawCharCount = texts.reduce((sum, text) => sum + countChars(text), 0);
    const scanned = isScanned(rawCharCount, total);

    const assembleStart = performance.now();
    const parsed = assembleBook(
      texts.map((text) => ({ text, images: [] })),
      outline,
    );
    record("parse.assemble", performance.now() - assembleStart, `${parsed.blocks.length} blocks`);
    record("parse.total", performance.now() - started, `${total} pages`);

    return { parsed, scanned };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
