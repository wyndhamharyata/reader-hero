import { Effect } from "effect";
import { BookMeta, ParsedBook } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import type { BookNotFound, PdfFailure } from "@/domain/errors";
import { isScanned } from "@/lib/pdf/assemble";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";
import { extractBook, type ParseProgress } from "./extract";

export function parseBook(
  id: string,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<ParsedBook, BookNotFound | PdfFailure | StorageFailure, BookStore | PdfClient> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const pdf = yield* PdfClient;

    const blob = yield* store.getFile(id);
    const data = yield* Effect.tryPromise({
      try: () => blob.arrayBuffer(),
      catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
    });

    const handle = yield* pdf.load(data);
    const result = yield* extractBook(handle, onProgress);

    yield* store.putParsed(id, result.parsed);

    const meta = yield* store.get(id);
    const scanned = isScanned(result.parsed.charCount, result.parsed.pageCount);
    const next = new BookMeta({
      ...meta,
      parseState: scanned ? "scanned" : "ready",
      charCount: result.parsed.charCount,
      figures: result.hasFigures ? "pending" : "none",
    });
    yield* store.putMeta(next);

    return result.parsed;
  });
}
