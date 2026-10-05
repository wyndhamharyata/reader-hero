import { Effect, Stream } from "effect";
import { BookMeta, ParsedBook } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import type { BookNotFound, PdfFailure } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";
import { assembleExtract, extractPages, type ParseProgress } from "./extract";

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
    const pages = yield* extractPages(handle).pipe(
      Stream.tap((read) => Effect.sync(() => onProgress({ page: read.page, total: read.total }))),
      Stream.runCollect,
    );
    const result = yield* assembleExtract(handle, pages);

    yield* store.putParsed(id, result.parsed);

    const meta = yield* store.get(id);
    const next = new BookMeta({
      ...meta,
      parseState: result.scanned ? "scanned" : "ready",
      charCount: result.parsed.charCount,
      figures: result.scanned ? "none" : "pending",
    });
    yield* store.putMeta(next);

    return result.parsed;
  });
}

export function reparseBook(
  id: string,
  onProgress: (progress: ParseProgress) => void,
  onMessage: (message: string) => void,
): Effect.Effect<void, never, BookStore | PdfClient> {
  const report = (error: BookNotFound | PdfFailure | StorageFailure) =>
    Effect.sync(() => onMessage(describeError(error, "This book")));
  return parseBook(id, onProgress).pipe(
    Effect.catchTags({ BookNotFound: report, PdfFailure: report, StorageFailure: report }),
  );
}

export function watchParsedBook(
  bookId: string,
  onParsed: () => void,
): Effect.Effect<void, never, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    yield* store.updates().pipe(
      Stream.filter((update) => update.kind === "parsed" && update.bookId === bookId),
      Stream.runForEach(() => Effect.sync(onParsed)),
    );
  });
}
