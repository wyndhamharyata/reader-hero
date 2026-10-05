import { Effect } from "effect";
import { BookMeta } from "@/domain/book";
import { StorageFailure, UnsupportedFile, type PdfFailure } from "@/domain/errors";
import { isScanned } from "@/lib/pdf/assemble";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { extractBook, type ParseProgress } from "./extract";

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const stripExtension = (name: string): string => name.replace(/\.pdf$/i, "").trim();

interface BookInfo {
  readonly title: string;
  readonly author?: string;
}

function readInfo(handle: PdfHandle): Effect.Effect<BookInfo> {
  return Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => handle.proxy.getMetadata(),
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    if (metadata === null) return { title: "" };

    const info = metadata.info as Record<string, unknown>;
    const title = typeof info.Title === "string" ? info.Title.trim() : "";
    const author = typeof info.Author === "string" ? info.Author.trim() : "";
    return author === "" ? { title } : { title, author };
  });
}

export function addPdf(
  file: File,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<
  BookMeta,
  UnsupportedFile | PdfFailure | StorageFailure,
  BookStore | PdfClient
> {
  return Effect.gen(function* () {
    if (!isPdf(file)) return yield* new UnsupportedFile({ name: file.name });

    const store = yield* BookStore;
    const pdf = yield* PdfClient;

    const data = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
    });

    const handle = yield* pdf.load(data);
    const info = yield* readInfo(handle);
    const id = crypto.randomUUID();

    const meta = new BookMeta({
      id,
      title: info.title || stripExtension(file.name) || "Untitled",
      author: info.author,
      addedAt: Date.now(),
      fileSize: file.size,
      pageCount: handle.numPages,
      parseState: "parsing",
      charCount: 0,
    });

    yield* store.putFile(id, file, meta);
    const parsed = yield* extractBook(handle, onProgress);
    yield* store.putParsed(id, parsed);

    const scanned = isScanned(parsed.charCount, parsed.pageCount);
    const ready = new BookMeta({
      ...meta,
      parseState: scanned ? "scanned" : "ready",
      charCount: parsed.charCount,
    });
    yield* store.putMeta(ready);

    return ready;
  });
}
