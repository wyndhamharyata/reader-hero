import { Effect, Stream } from "effect";
import type { ImagePlacement, PageText, ParsedBook } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
}

export interface ExtractResult {
  readonly parsed: ParsedBook;
  readonly hasFigures: boolean;
}

const READ_CONCURRENCY = 2;

const countChars = (text: PageText): number =>
  text.items.reduce((sum, item) => sum + item.str.length, 0);

/**
 * Reads text and figure placements (no rendering) so the reflowed book is ready
 * immediately. Figure pixels are rendered later by `renderFigures`.
 */
export function extractBook(
  handle: PdfHandle,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<ExtractResult, PdfFailure, PdfClient> {
  return Effect.gen(function* () {
    const pdf = yield* PdfClient;
    const total = pdf.pageCount(handle);

    const extracts = yield* Stream.range(1, total).pipe(
      Stream.mapEffect(
        (page) =>
          Effect.gen(function* () {
            const text = yield* pdf.readPage(handle, page);
            const placements = yield* pdf.readPlacements(handle, page).pipe(
              Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<ImagePlacement>)),
            );
            yield* Effect.sync(() => onProgress({ page, total }));
            return { text, placements };
          }),
        { concurrency: READ_CONCURRENCY },
      ),
      Stream.runCollect,
    );

    const outline = yield* pdf.readOutline(handle);
    const rawCharCount = extracts.reduce((sum, entry) => sum + countChars(entry.text), 0);

    // A scanned book has almost no text; its pages are full-page images that the
    // reader shows in the original view, so figures are neither placed nor rendered.
    const scanned = isScanned(rawCharCount, total);
    const pages = extracts.map((entry) => ({
      text: entry.text,
      images: scanned ? [] : entry.placements,
    }));

    const parsed = assembleBook(pages, outline);
    const hasFigures = pages.some((page) => page.images.length > 0);

    return { parsed, hasFigures };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
