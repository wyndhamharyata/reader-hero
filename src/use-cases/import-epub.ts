import { Effect, Exit, Option, Stream } from "effect";
import { unzipSync, type Unzipped } from "fflate";
import { Block, BookMeta, ParsedBook } from "@/domain/book";
import { EpubFailure, StorageFailure } from "@/domain/errors";
import { parseEpub, type EpubBook } from "@/lib/epub/parse";
import { newId } from "@/lib/id";
import { shrinkPicture } from "@/lib/picture";
import { BookStore } from "@/services/book-store";
import type { ParseProgress } from "./extract";

const textFiles = [".xml", ".opf", ".ncx", ".xhtml", ".html", ".htm", ".css"];

export function buildEpub(
  bookId: string,
  data: ArrayBuffer,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<EpubBook, EpubFailure | StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const zip = new Uint8Array(data);
    // Images inflate one at a time below, so the import never holds every image at once.
    const unzip = (keep: (name: string) => boolean): Effect.Effect<Unzipped, EpubFailure> =>
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

    const decode = (blob: Blob): Effect.Effect<Option.Option<ImageBitmap>> =>
      Effect.tryPromise(() => createImageBitmap(blob)).pipe(Effect.option);
    const ratios = new Map<string, number>();
    yield* Stream.fromIterable(book.images.entries()).pipe(
      Stream.mapEffect(([index, image]) =>
        Effect.gen(function* () {
          const bytes = (yield* unzip((name) => name === image.path))[image.path];
          if (bytes === undefined) return;
          const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image.type });
          // An SVG has no bitmap; the reader then sizes it from the file itself.
          const bitmap = yield* decode(blob);
          const size = Option.match(bitmap, {
            onNone: () => ({ width: 0, height: 0 }),
            onSome: (value) => ({ width: value.width, height: value.height }),
          });
          Option.map(bitmap, (value) => value.close());
          if (size.height > 0) ratios.set(image.id, size.width / size.height);
          yield* store.putImage(bookId, { id: image.id, blob, ...size });
          onProgress({ page: index + 1, total: book.images.length, step: "Image" });
        }),
      ),
      Stream.runDrain,
    );

    // The library card needs a small JPEG, like the page-1 render of a PDF.
    const cover = book.cover;
    const coverBytes =
      cover === null ? undefined : (yield* unzip((name) => name === cover.path))[cover.path];
    if (cover !== null && coverBytes !== undefined) {
      const shrunk = yield* shrinkPicture(
        new Blob([coverBytes as Uint8Array<ArrayBuffer>], { type: cover.type }),
      );
      // A rebuild keeps the reader's own cover, so the book's own goes where Reset finds it.
      const custom = yield* store.get(bookId).pipe(
        Effect.map((meta) => meta.customCover === true),
        Effect.orElseSucceed(() => false),
      );
      if (shrunk !== null) {
        yield* store.putImage(bookId, { id: custom ? "cover-default" : "cover", ...shrunk });
      }
    }

    // The placeholder has the image's final size, so a resume does not shift as images load.
    const blocks = book.parsed.blocks.map((block) => {
      const ratio = block.imageId === undefined ? undefined : ratios.get(block.imageId);
      return ratio === undefined ? block : new Block({ ...block, ratio });
    });
    return { ...book, parsed: new ParsedBook({ ...book.parsed, blocks }) };
  });
}

export function addEpub(
  file: File,
  name: string,
  onProgress: (progress: ParseProgress) => void,
): Effect.Effect<BookMeta, EpubFailure | StorageFailure, BookStore> {
  return Effect.gen(function* () {
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
        series: book.series,
        seriesNumber: book.seriesNumber,
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
      return ready;
    }).pipe(
      // Images land before the book row, so a failure must clear them too.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) ? Effect.void : Effect.ignore(store.remove(id)),
      ),
    );
  });
}
