import { Effect, Stream } from "effect";
import type { PageImage, PageText, ParsedBook, StoredImage } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
  readonly phase: "text" | "images";
}

export interface ExtractResult {
  readonly parsed: ParsedBook;
  readonly images: ReadonlyArray<StoredImage>;
}

const READ_CONCURRENCY = 2;
const IMAGE_CONCURRENCY = 2;

const countChars = (text: PageText): number =>
  text.items.reduce((sum, item) => sum + item.str.length, 0);

export function extractBook(
  handle: PdfHandle,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<ExtractResult, PdfFailure, PdfClient> {
  return Effect.gen(function* () {
    const pdf = yield* PdfClient;
    const total = pdf.pageCount(handle);

    const texts = yield* Stream.range(1, total).pipe(
      Stream.mapEffect(
        (page) =>
          pdf.readPage(handle, page).pipe(
            Effect.tap(() => Effect.sync(() => onProgress({ page, total, phase: "text" }))),
          ),
        { concurrency: READ_CONCURRENCY },
      ),
      Stream.runCollect,
    );

    const outline = yield* pdf.readOutline(handle);
    const rawCharCount = texts.reduce((sum, text) => sum + countChars(text), 0);

    // A scanned book has almost no text; its pages are full-page images that the
    // reader shows in the original view, so extracting figures is wasted work.
    // For everything else, extract figures from every page, including text-less
    // front matter such as covers and title pages.
    const pages = isScanned(rawCharCount, total)
      ? texts.map((text) => ({ text, images: [] as ReadonlyArray<PageImage> }))
      : yield* Effect.forEach(
          texts,
          (text) =>
            pdf.readImages(handle, text.page).pipe(
              Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<PageImage>)),
              Effect.tap(() =>
                Effect.sync(() => onProgress({ page: text.page, total, phase: "images" })),
              ),
              Effect.map((images) => ({ text, images })),
            ),
          { concurrency: IMAGE_CONCURRENCY },
        );

    const parsed = assembleBook(pages, outline);
    const images = pages.flatMap((page) =>
      page.images.map((image) => ({
        id: image.id,
        blob: image.blob,
        width: image.width,
        height: image.height,
      })),
    );

    return { parsed, images };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
