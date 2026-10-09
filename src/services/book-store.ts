import { Context, Effect, Layer, PubSub, Stream } from "effect";
import {
  BookMeta,
  BookPrefs,
  FigureCheckpoint,
  ImageRecord,
  PARSED_VERSION,
  ParsedBook,
  ReadingProgress,
  type Series,
  type PageText,
  type StoredImage,
} from "@/domain/book";
import { BookNotFound, ParsedMissing, StorageFailure } from "@/domain/errors";
import {
  decodeBookMeta,
  decodeBookPrefs,
  decodeFigureCheckpoint,
  decodeImageRecord,
  decodeParsedBook,
  decodeReadingProgress,
  decodeSeries,
  decodeStoredPages,
} from "@/lib/codecs";
import { openReaderDb, type InboxFile } from "@/lib/db";

export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

export type StoreUpdate =
  | { readonly kind: "series" }
  | { readonly kind: "image"; readonly bookId: string; readonly imageId: string }
  | { readonly kind: "meta"; readonly bookId: string }
  | { readonly kind: "parsed"; readonly bookId: string }
  | { readonly kind: "progress"; readonly bookId: string };

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
    listSeries(): Effect.Effect<ReadonlyArray<Series>, StorageFailure>;
    getSeries(id: string): Effect.Effect<Series | null, StorageFailure>;
    putSeries(series: Series): Effect.Effect<void, StorageFailure>;
    removeSeries(id: string): Effect.Effect<void, StorageFailure>;
    get(id: string): Effect.Effect<BookMeta, BookNotFound | StorageFailure>;
    putMeta(meta: BookMeta): Effect.Effect<void, StorageFailure>;
    putFile(id: string, blob: Blob, meta: BookMeta): Effect.Effect<void, StorageFailure>;
    getFile(id: string): Effect.Effect<Blob, BookNotFound | StorageFailure>;
    putParsed(id: string, parsed: ParsedBook): Effect.Effect<void, StorageFailure>;
    getParsed(id: string): Effect.Effect<ParsedBook, BookNotFound | ParsedMissing | StorageFailure>;
    putImage(bookId: string, image: StoredImage): Effect.Effect<void, StorageFailure>;
    updates(): Stream.Stream<StoreUpdate>;
    getImage(bookId: string, imageId: string): Effect.Effect<ImageRecord | null, StorageFailure>;
    listImages(
      bookId: string,
    ): Effect.Effect<
      ReadonlyArray<{ readonly id: string; readonly image: ImageRecord }>,
      StorageFailure
    >;
    putProgress(id: string, progress: ReadingProgress): Effect.Effect<void, StorageFailure>;
    getProgress(id: string): Effect.Effect<ReadingProgress | null, StorageFailure>;
    getPrefs(id: string): Effect.Effect<BookPrefs | null, StorageFailure>;
    putPrefs(id: string, prefs: BookPrefs): Effect.Effect<void, StorageFailure>;
    getFigureCheckpoint(id: string): Effect.Effect<ReadonlyArray<number>, StorageFailure>;
    putFigureCheckpoint(
      id: string,
      pages: ReadonlyArray<number>,
    ): Effect.Effect<void, StorageFailure>;
    putPages(id: string, pages: ReadonlyArray<PageText>): Effect.Effect<void, StorageFailure>;
    getPages(id: string): Effect.Effect<ReadonlyArray<PageText> | null, StorageFailure>;
    deletePages(id: string): Effect.Effect<void, StorageFailure>;
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
          decodeBookMeta(row).pipe(
            Effect.mapError((cause) => new StorageFailure({ operation: "decodeBookMeta", cause })),
          ),
        );
      });

      const listSeries = Effect.fn("BookStore.listSeries")(function* () {
        const rows = yield* attempt("listSeries", () => db.getAll("series"));
        // A series record that no longer decodes drops out, so the library still opens.
        const series = yield* Effect.forEach(rows, (row) =>
          decodeSeries(row).pipe(Effect.catch(() => Effect.succeed(null))),
        );
        return series.filter((entry) => entry !== null);
      });

      const getSeries = Effect.fn("BookStore.getSeries")(function* (id: string) {
        const row = yield* attempt("getSeries", () => db.get("series", id));
        if (row === undefined) return null;
        return yield* decodeSeries(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const putSeries = Effect.fn("BookStore.putSeries")(function* (series: Series) {
        yield* attempt("putSeries", () => db.put("series", series));
        yield* PubSub.publish(updateBus, { kind: "series" });
      });

      const removeSeries = Effect.fn("BookStore.removeSeries")(function* (id: string) {
        yield* attempt("removeSeries", () => db.delete("series", id));
        yield* PubSub.publish(updateBus, { kind: "series" });
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
        yield* PubSub.publish(updateBus, { kind: "meta", bookId: meta.id });
      });

      const putFile = Effect.fn("BookStore.putFile")(function* (
        id: string,
        blob: Blob,
        meta: BookMeta,
      ) {
        yield* attempt("putFile", async () => {
          const tx = db.transaction(["books", "files"], "readwrite");
          await tx.objectStore("books").put(meta);
          await tx.objectStore("files").put(blob, id);
          await tx.done;
        });
      });

      const getFile = Effect.fn("BookStore.getFile")(function* (id: string) {
        const blob = yield* attempt("getFile", () => db.get("files", id));
        if (blob === undefined) return yield* new BookNotFound({ id });
        return blob;
      });

      const putParsed = Effect.fn("BookStore.putParsed")(function* (
        id: string,
        parsed: ParsedBook,
      ) {
        yield* attempt("putParsed", () => db.put("parsed", parsed, id));
        yield* PubSub.publish(updateBus, { kind: "parsed", bookId: id });
      });

      const getParsed = Effect.fn("BookStore.getParsed")(function* (id: string) {
        const row = yield* attempt("getParsed", () => db.get("parsed", id));
        if (row === undefined) return yield* new ParsedMissing({ id });
        const parsed = yield* decodeParsedBook(row).pipe(
          Effect.mapError(() => new ParsedMissing({ id })),
        );
        if (parsed.version !== PARSED_VERSION) return yield* new ParsedMissing({ id });
        return parsed;
      });

      const putImage = Effect.fn("BookStore.putImage")(function* (
        bookId: string,
        image: StoredImage,
      ) {
        yield* attempt("putImage", () =>
          db.put(
            "images",
            new ImageRecord({
              blob: image.blob,
              width: image.width,
              height: image.height,
              x: image.x,
              y: image.y,
            }),
            `${bookId}/${image.id}`,
          ),
        );
        yield* PubSub.publish(updateBus, { kind: "image", bookId, imageId: image.id });
      });

      const updates = () => Stream.fromPubSub(updateBus);

      const getImage = Effect.fn("BookStore.getImage")(function* (bookId: string, imageId: string) {
        const row = yield* attempt("getImage", () => db.get("images", `${bookId}/${imageId}`));
        if (row === undefined) return null;
        return yield* decodeImageRecord(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const listImages = Effect.fn("BookStore.listImages")(function* (bookId: string) {
        // One transaction, so the keys and the rows line up.
        const [keys, rows] = yield* attempt("listImages", async () => {
          const store = db.transaction("images").store;
          return Promise.all([
            store.getAllKeys(imageRange(bookId)),
            store.getAll(imageRange(bookId)),
          ]);
        });
        const images: Array<{ readonly id: string; readonly image: ImageRecord }> = [];
        for (const [index, row] of rows.entries()) {
          const key = keys[index];
          const image = yield* decodeImageRecord(row).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          if (key !== undefined && image !== null) {
            images.push({ id: key.slice(bookId.length + 1), image });
          }
        }
        return images;
      });

      const putProgress = Effect.fn("BookStore.putProgress")(function* (
        id: string,
        progress: ReadingProgress,
      ) {
        yield* attempt("putProgress", () => db.put("progress", progress, id));
        yield* PubSub.publish(updateBus, { kind: "progress", bookId: id });
      });

      const getProgress = Effect.fn("BookStore.getProgress")(function* (id: string) {
        const row = yield* attempt("getProgress", () => db.get("progress", id));
        if (row === undefined) return null;
        return yield* decodeReadingProgress(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const getPrefs = Effect.fn("BookStore.getPrefs")(function* (id: string) {
        const row = yield* attempt("getPrefs", () => db.get("prefs", id));
        if (row === undefined) return null;
        return yield* decodeBookPrefs(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const putPrefs = Effect.fn("BookStore.putPrefs")(function* (id: string, prefs: BookPrefs) {
        yield* attempt("putPrefs", () => db.put("prefs", prefs, id));
      });

      const getFigureCheckpoint = Effect.fn("BookStore.getFigureCheckpoint")(function* (
        id: string,
      ) {
        const row = yield* attempt("getFigureCheckpoint", () => db.get("figures", id));
        if (row === undefined) return [];
        const checkpoint = yield* decodeFigureCheckpoint(row).pipe(
          Effect.catch(() => Effect.succeed(new FigureCheckpoint({}))),
        );
        const pages = [...(checkpoint.pages ?? [])];
        for (let page = 1; page <= (checkpoint.through ?? 0); page += 1) pages.push(page);
        return pages;
      });

      const putFigureCheckpoint = Effect.fn("BookStore.putFigureCheckpoint")(function* (
        id: string,
        pages: ReadonlyArray<number>,
      ) {
        yield* attempt("putFigureCheckpoint", () =>
          db.put("figures", new FigureCheckpoint({ pages }), id),
        );
      });

      const putPages = Effect.fn("BookStore.putPages")(function* (
        id: string,
        pages: ReadonlyArray<PageText>,
      ) {
        yield* attempt("putPages", () => db.put("pages", pages, id));
      });

      const getPages = Effect.fn("BookStore.getPages")(function* (id: string) {
        const row = yield* attempt("getPages", () => db.get("pages", id));
        if (row === undefined) return null;
        return yield* decodeStoredPages(row).pipe(
          Effect.map((pages): ReadonlyArray<PageText> => pages),
          Effect.catch(() => Effect.succeed(null)),
        );
      });

      const deletePages = Effect.fn("BookStore.deletePages")(function* (id: string) {
        yield* attempt("deletePages", () => db.delete("pages", id));
      });

      const remove = Effect.fn("BookStore.remove")(function* (id: string) {
        yield* attempt("remove", async () => {
          const tx = db.transaction(
            ["books", "files", "parsed", "progress", "images", "prefs", "figures", "pages"],
            "readwrite",
          );
          await tx.objectStore("books").delete(id);
          await tx.objectStore("files").delete(id);
          await tx.objectStore("parsed").delete(id);
          await tx.objectStore("progress").delete(id);
          await tx.objectStore("images").delete(imageRange(id));
          await tx.objectStore("prefs").delete(id);
          await tx.objectStore("figures").delete(id);
          await tx.objectStore("pages").delete(id);
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
        listSeries,
        getSeries,
        putSeries,
        removeSeries,
        get,
        putMeta,
        putFile,
        getFile,
        putParsed,
        getParsed,
        putImage,
        updates,
        getImage,
        listImages,
        putProgress,
        getProgress,
        getPrefs,
        putPrefs,
        getFigureCheckpoint,
        putFigureCheckpoint,
        putPages,
        getPages,
        deletePages,
        remove,
        estimate,
        requestPersistent,
        takeInbox,
      });
    }),
  );
}
