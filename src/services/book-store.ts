import { Context, Effect, Layer, PubSub, Stream } from "effect";
import {
  BookMeta,
  ImageRecord,
  PARSED_VERSION,
  ParsedBook,
  ReadingProgress,
  type StoredImage,
} from "@/domain/book";
import { BookNotFound, ParsedMissing, StorageFailure } from "@/domain/errors";
import {
  decodeBookMeta,
  decodeImageRecord,
  decodeParsedBook,
  decodeReadingProgress,
} from "@/lib/codecs";
import { openReaderDb, type InboxFile } from "@/lib/db";

export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

export interface StoreUpdate {
  readonly bookId: string;
  /** The image that became available, or null when the book meta changed. */
  readonly imageId: string | null;
}

const imageRange = (bookId: string): IDBKeyRange =>
  IDBKeyRange.bound(`${bookId}/`, `${bookId}/\uffff`);

const attempt = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, StorageFailure> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ operation, cause }),
  });

export class BookStore extends Context.Service<
  BookStore,
  {
    list(): Effect.Effect<ReadonlyArray<BookMeta>, StorageFailure>;
    get(id: string): Effect.Effect<BookMeta, BookNotFound | StorageFailure>;
    putMeta(meta: BookMeta): Effect.Effect<void, StorageFailure>;
    putFile(id: string, blob: Blob, meta: BookMeta): Effect.Effect<void, StorageFailure>;
    getFile(id: string): Effect.Effect<Blob, BookNotFound | StorageFailure>;
    putParsed(id: string, parsed: ParsedBook): Effect.Effect<void, StorageFailure>;
    getParsed(
      id: string,
    ): Effect.Effect<ParsedBook, BookNotFound | ParsedMissing | StorageFailure>;
    putImage(bookId: string, image: StoredImage): Effect.Effect<void, StorageFailure>;
    updates(): Stream.Stream<StoreUpdate>;
    getImage(
      bookId: string,
      imageId: string,
    ): Effect.Effect<ImageRecord | null, StorageFailure>;
    putProgress(id: string, progress: ReadingProgress): Effect.Effect<void, StorageFailure>;
    getProgress(id: string): Effect.Effect<ReadingProgress | null, StorageFailure>;
    remove(id: string): Effect.Effect<void, StorageFailure>;
    estimate(): Effect.Effect<StorageEstimate | null>;
    requestPersistent(): Effect.Effect<boolean>;
    takeInbox(): Effect.Effect<ReadonlyArray<InboxFile>, StorageFailure>;
  }
>()("reader-hero/BookStore") {
  static readonly layer = Layer.effect(
    BookStore,
    Effect.gen(function* () {
      const db = yield* attempt("open", () => openReaderDb());
      const updateBus = yield* PubSub.unbounded<StoreUpdate>();

      const list = Effect.fn("BookStore.list")(function* () {
        const rows = yield* attempt("list", () => db.getAll("books"));
        return yield* Effect.forEach(rows, (row) =>
          decodeBookMeta(row).pipe(Effect.mapError((cause) => new StorageFailure({ operation: "decodeBookMeta", cause }))),
        );
      });

      const get = Effect.fn("BookStore.get")(function* (id: string) {
        const row = yield* attempt("get", () => db.get("books", id));
        if (row === undefined) return yield* new BookNotFound({ id });
        return yield* decodeBookMeta(row).pipe(
          Effect.mapError((cause) => new StorageFailure({ operation: "decodeBookMeta", cause })),
        );
      });

      const putMeta = Effect.fn("BookStore.putMeta")(function* (meta: BookMeta) {
        yield* attempt("putMeta", () => db.put("books", meta));
        yield* PubSub.publish(updateBus, { bookId: meta.id, imageId: null });
      });

      const putFile = Effect.fn("BookStore.putFile")(
        function* (id: string, blob: Blob, meta: BookMeta) {
          yield* attempt("putFile", async () => {
            const tx = db.transaction(["books", "files"], "readwrite");
            await tx.objectStore("books").put(meta);
            await tx.objectStore("files").put(blob, id);
            await tx.done;
          });
        },
      );

      const getFile = Effect.fn("BookStore.getFile")(function* (id: string) {
        const blob = yield* attempt("getFile", () => db.get("files", id));
        if (blob === undefined) return yield* new BookNotFound({ id });
        return blob;
      });

      const putParsed = Effect.fn("BookStore.putParsed")(
        function* (id: string, parsed: ParsedBook) {
          yield* attempt("putParsed", () => db.put("parsed", parsed, id));
        },
      );

      const getParsed = Effect.fn("BookStore.getParsed")(function* (id: string) {
        const row = yield* attempt("getParsed", () => db.get("parsed", id));
        if (row === undefined) return yield* new ParsedMissing({ id });
        const parsed = yield* decodeParsedBook(row).pipe(
          Effect.mapError(() => new ParsedMissing({ id })),
        );
        if (parsed.version !== PARSED_VERSION) return yield* new ParsedMissing({ id });
        return parsed;
      });

      const putImage = Effect.fn("BookStore.putImage")(
        function* (bookId: string, image: StoredImage) {
          yield* attempt("putImage", () =>
            db.put(
              "images",
              new ImageRecord({ blob: image.blob, width: image.width, height: image.height }),
              `${bookId}/${image.id}`,
            ),
          );
          yield* PubSub.publish(updateBus, { bookId, imageId: image.id });
        },
      );

      const updates = () => Stream.fromPubSub(updateBus);

      const getImage = Effect.fn("BookStore.getImage")(
        function* (bookId: string, imageId: string) {
          const row = yield* attempt("getImage", () => db.get("images", `${bookId}/${imageId}`));
          if (row === undefined) return null;
          return yield* decodeImageRecord(row).pipe(Effect.catch(() => Effect.succeed(null)));
        },
      );

      const putProgress = Effect.fn("BookStore.putProgress")(
        function* (id: string, progress: ReadingProgress) {
          yield* attempt("putProgress", () => db.put("progress", progress, id));
        },
      );

      const getProgress = Effect.fn("BookStore.getProgress")(function* (id: string) {
        const row = yield* attempt("getProgress", () => db.get("progress", id));
        if (row === undefined) return null;
        return yield* decodeReadingProgress(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const remove = Effect.fn("BookStore.remove")(function* (id: string) {
        yield* attempt("remove", async () => {
          const tx = db.transaction(
            ["books", "files", "parsed", "progress", "images"],
            "readwrite",
          );
          await tx.objectStore("books").delete(id);
          await tx.objectStore("files").delete(id);
          await tx.objectStore("parsed").delete(id);
          await tx.objectStore("progress").delete(id);
          await tx.objectStore("images").delete(imageRange(id));
          await tx.done;
        });
      });

      const estimate = Effect.fn("BookStore.estimate")(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            const { usage, quota } = await navigator.storage.estimate();
            return { usage: usage ?? 0, quota: quota ?? 0 };
          },
          catch: () => new StorageFailure({ operation: "estimate", cause: "unavailable" }),
        }).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const requestPersistent = Effect.fn("BookStore.requestPersistent")(function* () {
        return yield* attempt("requestPersistent", () => navigator.storage.persist()).pipe(
          Effect.orElseSucceed(() => false),
        );
      });

      const takeInbox = Effect.fn("BookStore.takeInbox")(function* () {
        return yield* attempt("takeInbox", async () => {
          const tx = db.transaction("inbox", "readwrite");
          const store = tx.objectStore("inbox");
          const files = await store.getAll();
          await store.clear();
          await tx.done;
          return files;
        });
      });

      return BookStore.of({
        list,
        get,
        putMeta,
        putFile,
        getFile,
        putParsed,
        getParsed,
        putImage,
        updates,
        getImage,
        putProgress,
        getProgress,
        remove,
        estimate,
        requestPersistent,
        takeInbox,
      });
    }),
  );
}
