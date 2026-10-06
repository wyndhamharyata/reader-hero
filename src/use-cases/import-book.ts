import { Effect, Exit, Stream } from "effect";
import { BookMeta } from "@/domain/book";
import { StorageFailure, UnsupportedFile, type PdfFailure } from "@/domain/errors";
import { newId } from "@/lib/id";
import { record } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { assembleExtract, extractPages, type ParseProgress } from "./extract";

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const stripExtension = (name: string): string => name.replace(/\.pdf$/i, "").trim();

interface BookInfo {
  readonly title: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
}

function readInfo(handle: PdfHandle): Effect.Effect<BookInfo> {
  return Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => handle.proxy.getMetadata(),
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    if (metadata === null) return { title: "" };

    const info = metadata.info as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const optional = (value: unknown) => text(value) || undefined;
    return {
      title: text(info.Title),
      author: optional(info.Author),
      subject: optional(info.Subject),
      keywords: optional(info.Keywords),
    };
  });
}

export function addPdf(
  file: File,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<BookMeta, UnsupportedFile | PdfFailure | StorageFailure, BookStore | PdfClient> {
  return Effect.gen(function* () {
    if (!isPdf(file)) return yield* new UnsupportedFile({ name: file.name });

    const started = performance.now();
    const store = yield* BookStore;
    const pdf = yield* PdfClient;

    const data = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
    });

    const handle = yield* pdf.load(data);
    return yield* Effect.gen(function* () {
      const info = yield* readInfo(handle);
      const id = newId();

      const meta = new BookMeta({
        id,
        title: info.title || stripExtension(file.name) || "Untitled",
        author: info.author,
        subject: info.subject,
        keywords: info.keywords,
        fileName: file.name,
        addedAt: Date.now(),
        fileSize: file.size,
        pageCount: handle.numPages,
        parseState: "parsing",
        charCount: 0,
      });

      yield* store.putFile(id, file, meta);
      // From here the book is in the library; a failure or cancel must not leave it "Building reader".
      const parse = Effect.gen(function* () {
        const pages = yield* extractPages(handle).pipe(
          Stream.tap((read) =>
            Effect.sync(() => onProgress({ page: read.page, total: read.total })),
          ),
          Stream.runCollect,
        );
        const result = yield* assembleExtract(handle, pages);
        yield* store.putParsed(id, result.parsed);

        const ready = new BookMeta({
          ...meta,
          parseState: result.scanned ? "scanned" : "ready",
          charCount: result.parsed.charCount,
          figures: result.scanned ? "none" : "pending",
        });
        yield* store.putMeta(ready);
        return ready;
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit) ? Effect.void : Effect.ignore(store.remove(id)),
        ),
      );
      const ready = yield* parse;
      record("import.total", performance.now() - started, ready.title);

      return ready;
    }).pipe(Effect.ensuring(pdf.release(handle)));
  });
}
