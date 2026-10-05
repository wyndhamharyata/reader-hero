import { Effect, Stream } from "effect";
import type { PageImage, ParsedBook, StoredImage } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
}

export interface ExtractResult {
  readonly parsed: ParsedBook;
  readonly images: ReadonlyArray<StoredImage>;
}

const READ_CONCURRENCY = 2;

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
            let images: ReadonlyArray<PageImage> = [];
            if (text.items.length > 0) {
              images = yield* pdf.readImages(handle, page).pipe(
                Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<PageImage>)),
              );
            }
            yield* Effect.sync(() => onProgress({ page, total }));
            return { text, images };
          }),
        { concurrency: READ_CONCURRENCY },
      ),
      Stream.runCollect,
    );

    const outline = yield* pdf.readOutline(handle);
    const parsed = assembleBook(extracts, outline);
    const images = extracts.flatMap((entry) =>
      entry.images.map((image) => ({
        id: image.id,
        blob: image.blob,
        width: image.width,
        height: image.height,
      })),
    );

    return { parsed, images };
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
