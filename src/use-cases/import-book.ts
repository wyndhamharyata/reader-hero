import { Effect, Exit, Option, Schema, Stream } from "effect";
import { BookMeta } from "@/domain/book";
import {
  StorageFailure,
  UnsupportedFile,
  type EpubFailure,
  type PdfFailure,
} from "@/domain/errors";
import { newId } from "@/lib/id";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { assembleExtract, extractPages, type ParseProgress } from "./extract";
import { addEpub } from "./import-epub";

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isEpub = (file: File): boolean =>
  file.type === "application/epub+zip" || file.name.toLowerCase().endsWith(".epub");

const stripExtension = (name: string): string => name.replace(/\.(pdf|epub)$/i, "").trim();

// The PDF info dictionary is untrusted; each field decodes alone, so one bad field drops only itself.
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodeText = Schema.decodeUnknownOption(Schema.String);

function readInfo(handle: PdfHandle): Effect.Effect<{
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
}> {
  return Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => handle.proxy.getMetadata(),
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    const info = Option.getOrElse(
      decodeRecord(metadata?.info),
      (): Readonly<Record<string, unknown>> => ({}),
    );
    const text = (key: string): string | undefined =>
      Option.getOrUndefined(decodeText(info[key]))?.trim() || undefined;
    return {
      title: text("Title"),
      author: text("Author"),
      subject: text("Subject"),
      keywords: text("Keywords"),
    };
  });
}

export function addBook(
  file: File,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<
  BookMeta,
  UnsupportedFile | PdfFailure | EpubFailure | StorageFailure,
  BookStore | PdfClient
> {
  return Effect.gen(function* () {
    if (isEpub(file)) {
      return yield* addEpub(file, stripExtension(file.name) || "Untitled", onProgress);
    }
    if (!isPdf(file)) return yield* new UnsupportedFile({ name: file.name });

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
        title: info.title ?? (stripExtension(file.name) || "Untitled"),
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

      return ready;
    }).pipe(Effect.ensuring(pdf.release(handle)));
  });
}
