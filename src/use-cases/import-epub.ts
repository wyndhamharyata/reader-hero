import { Effect, Exit } from "effect";
import { unzipSync } from "fflate";
import { BookMeta } from "@/domain/book";
import { EpubFailure, StorageFailure } from "@/domain/errors";
import { parseEpub, type EpubBook } from "@/lib/epub/parse";
import { newId } from "@/lib/id";
import { record } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import type { ParseProgress } from "./extract";

const textFiles = [".xml", ".opf", ".ncx", ".xhtml", ".html", ".htm", ".css"];

// Stores the book's images under `bookId` and returns the parsed text; the caller stores that.
export function buildEpub(
  bookId: string,
  data: ArrayBuffer,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<EpubBook, EpubFailure | StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const zip = new Uint8Array(data);
    // Images inflate one at a time below, so the import never holds every image at once.
    const unzip = (keep: (name: string) => boolean) =>
      Effect.try({
        try: () => unzipSync(zip, { filter: (file) => keep(file.name) }),
        catch: () => new EpubFailure({ reason: "corrupt" }),
      });

    const files = yield* unzip((name) =>
      textFiles.some((extension) => name.toLowerCase().endsWith(extension)),
    );
    const book = yield* parseEpub(files, (page, total) =>
      onProgress({ page, total, step: "Chapter" }),
    );

    const decode = (blob: Blob) =>
      Effect.tryPromise(() => createImageBitmap(blob)).pipe(Effect.option);
    for (const [index, image] of book.images.entries()) {
      const bytes = (yield* unzip((name) => name === image.path))[image.path];
      if (bytes === undefined) continue;
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image.type });
      // An SVG has no bitmap; the reader then sizes it from the file itself.
      const bitmap = yield* decode(blob);
      const size =
        bitmap._tag === "Some"
          ? { width: bitmap.value.width, height: bitmap.value.height }
          : { width: 0, height: 0 };
      if (bitmap._tag === "Some") bitmap.value.close();
      yield* store.putImage(bookId, { id: image.id, blob, ...size });
      onProgress({ page: index + 1, total: book.images.length, step: "Image" });
    }

    // The library card needs a small JPEG, like the page-1 render of a PDF.
    const cover = book.cover;
    const coverBytes =
      cover === null ? undefined : (yield* unzip((name) => name === cover.path))[cover.path];
    if (cover !== null && coverBytes !== undefined) {
      const bitmap = yield* decode(
        new Blob([coverBytes as Uint8Array<ArrayBuffer>], { type: cover.type }),
      );
      if (bitmap._tag === "Some") {
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = Math.round((400 * bitmap.value.height) / bitmap.value.width);
        canvas.getContext("2d")?.drawImage(bitmap.value, 0, 0, canvas.width, canvas.height);
        bitmap.value.close();
        const blob = yield* Effect.promise(
          () => new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85)),
        );
        if (blob !== null) {
          yield* store.putImage(bookId, {
            id: "cover",
            blob,
            width: canvas.width,
            height: canvas.height,
          });
        }
      }
    }

    return book;
  });
}

export function addEpub(
  file: File,
  name: string,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<BookMeta, EpubFailure | StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const started = performance.now();
    const store = yield* BookStore;
    const data = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
    });
    const id = newId();

    return yield* Effect.gen(function* () {
      const book = yield* buildEpub(id, data, onProgress);
      const meta = new BookMeta({
        id,
        title: book.title ?? name,
        author: book.author,
        subject: book.subject,
        fileName: file.name,
        format: "epub",
        addedAt: Date.now(),
        fileSize: file.size,
        pageCount: book.parsed.pageCount,
        parseState: "parsing",
        charCount: book.parsed.charCount,
        figures: book.images.length > 0 ? "ready" : "none",
      });
      yield* store.putFile(id, file, meta);
      yield* store.putParsed(id, book.parsed);
      const ready = new BookMeta({ ...meta, parseState: "ready" });
      yield* store.putMeta(ready);
      record("import.total", performance.now() - started, ready.title);
      return ready;
    }).pipe(
      // Images land before the book row, so a failure must clear them too.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) ? Effect.void : Effect.ignore(store.remove(id)),
      ),
    );
  });
}
