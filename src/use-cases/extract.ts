import { Effect, Stream } from "effect";
import type { ParsedBook } from "@/domain/book";
import type { PdfFailure } from "@/domain/errors";
import { assembleBook } from "@/lib/pdf/assemble";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface ParseProgress {
  readonly page: number;
  readonly total: number;
}

const READ_CONCURRENCY = 4;

export function extractBook(
  handle: PdfHandle,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<ParsedBook, PdfFailure, PdfClient> {
  return Effect.gen(function* () {
    const pdf = yield* PdfClient;
    const total = pdf.pageCount(handle);

    const pages = yield* Stream.range(1, total).pipe(
      Stream.mapEffect(
        (page) =>
          pdf
            .readPage(handle, page)
            .pipe(Effect.tap(() => Effect.sync(() => onProgress({ page, total })))),
        { concurrency: READ_CONCURRENCY },
      ),
      Stream.runCollect,
    );

    const outline = yield* pdf.readOutline(handle);
    return assembleBook(pages, outline);
  }).pipe(Effect.ensuring(PdfClient.use((pdf) => pdf.release(handle))));
}
