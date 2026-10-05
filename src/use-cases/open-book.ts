import { Effect } from "effect";
import type { PageSize } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import type { BookNotFound, PdfFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export interface OriginalPages {
  readonly handle: PdfHandle;
  readonly sizes: ReadonlyArray<PageSize>;
}

export function openOriginalPages(
  bookId: string,
): Effect.Effect<
  OriginalPages,
  BookNotFound | StorageFailure | PdfFailure,
  BookStore | PdfClient
> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const pdf = yield* PdfClient;

    const blob = yield* store.getFile(bookId);
    const data = yield* Effect.tryPromise({
      try: () => blob.arrayBuffer(),
      catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
    });

    const handle = yield* pdf.load(data);
    const sizes = yield* pdf.pageSizes(handle);
    return { handle, sizes };
  });
}

export function releaseOriginalPages(
  handle: PdfHandle,
): Effect.Effect<void, never, PdfClient> {
  return Effect.flatMap(PdfClient, (pdf) => pdf.release(handle));
}
