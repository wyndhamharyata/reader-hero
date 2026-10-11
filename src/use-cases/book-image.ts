import { Effect, Stream } from "effect";
import { BookMeta, type ImageRecord } from "@/domain/book";
import { StorageFailure, type BookNotFound } from "@/domain/errors";
import { shrinkPicture } from "@/lib/picture";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";

export function watchBookImage(
  bookId: string,
  imageId: string,
  onImage: (image: ImageRecord | null) => void,
): Effect.Effect<void, never, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const pull = store
      .getImage(bookId, imageId)
      .pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null)));

    yield* pull.pipe(Effect.flatMap((image) => Effect.sync(() => onImage(image))));

    yield* store.updates().pipe(
      Stream.filter(
        (update) =>
          update.kind === "image" && update.bookId === bookId && update.imageId === imageId,
      ),
      Stream.mapEffect(() => pull),
      Stream.mapEffect((image) => Effect.sync(() => onImage(image))),
      Stream.runDrain,
    );
  });
}

// One book at a time: each cover loads a whole PDF, and the library can hold many.
export function ensureCovers(
  bookIds: ReadonlyArray<string>,
): Effect.Effect<void, never, BookStore | PdfClient> {
  return Effect.forEach(
    bookIds,
    (bookId) =>
      Effect.gen(function* () {
        const store = yield* BookStore;
        const pdf = yield* PdfClient;
        if ((yield* store.getImage(bookId, "cover")) !== null) return;
        // An EPUB stores its cover at import; pdf.js cannot open one.
        if ((yield* store.get(bookId)).format === "epub") return;

        const blob = yield* store.getFile(bookId);
        const data = yield* Effect.tryPromise({
          try: () => blob.arrayBuffer(),
          catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
        });
        const cover = yield* Effect.acquireUseRelease(
          pdf.load(data),
          (handle) => pdf.thumbnail(handle, 1, 400),
          (handle) => pdf.release(handle),
        );
        if (cover !== null) yield* store.putImage(bookId, { id: "cover", ...cover });
        // A cover that fails to render keeps its placeholder; the next library visit retries it.
      }).pipe(Effect.catch(() => Effect.void)),
    { discard: true },
  );
}

// The book's own cover is kept the first time, so Reset can bring it back; false when the picture does not decode.
export function setBookCover(
  bookId: string,
  picture: Blob,
): Effect.Effect<boolean, BookNotFound | StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const shrunk = yield* shrinkPicture(picture);
    if (shrunk === null) return false;
    const meta = yield* store.get(bookId);
    if (meta.customCover !== true) {
      const own = yield* store.getImage(bookId, "cover");
      if (own !== null) {
        yield* store.putImage(bookId, {
          id: "cover-default",
          blob: own.blob,
          width: own.width,
          height: own.height,
        });
      }
    }
    yield* store.putImage(bookId, { id: "cover", ...shrunk });
    yield* store.putMeta(new BookMeta({ ...meta, customCover: true }));
    return true;
  });
}

// A PDF with no kept cover renders its first page again, as a new import does.
export function resetBookCover(
  bookId: string,
): Effect.Effect<void, BookNotFound | StorageFailure, BookStore | PdfClient> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const meta = yield* store.get(bookId);
    const own = yield* store.getImage(bookId, "cover-default");
    if (own === null) yield* store.removeImage(bookId, "cover");
    else {
      yield* store.putImage(bookId, {
        id: "cover",
        blob: own.blob,
        width: own.width,
        height: own.height,
      });
      yield* store.removeImage(bookId, "cover-default");
    }
    const { customCover: _customCover, ...rest } = meta;
    yield* store.putMeta(new BookMeta(rest));
    yield* ensureCovers([bookId]);
  });
}
