import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { Annotation } from "@/domain/annotation";
import { StorageFailure } from "@/domain/errors";
import { decodeAnnotation } from "@/lib/codecs";
import { withReaderDb } from "@/lib/db";

const attempt = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, StorageFailure> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ operation, cause }),
  });

const bookKeys = (bookId: string): IDBKeyRange =>
  IDBKeyRange.bound(`${bookId}/`, `${bookId}/\uffff`);

export class AnnotationStore extends Context.Service<
  AnnotationStore,
  {
    list(bookId: string): Effect.Effect<ReadonlyArray<Annotation>, StorageFailure>;
    count(bookId: string): Effect.Effect<number, StorageFailure>;
    // Highlights per book, one key pass, for the library's counts and flags.
    counts(): Effect.Effect<ReadonlyMap<string, number>, StorageFailure>;
    // Every book's highlights, for the library's list.
    listAll(): Effect.Effect<ReadonlyArray<Annotation>, StorageFailure>;
    put(annotation: Annotation): Effect.Effect<void, StorageFailure>;
    remove(bookId: string, id: string): Effect.Effect<void, StorageFailure>;
    // The book's highlights, then each change to them.
    watch(bookId: string): Stream.Stream<ReadonlyArray<Annotation>>;
    watchCounts(): Stream.Stream<ReadonlyMap<string, number>>;
    watchAll(): Stream.Stream<ReadonlyArray<Annotation>>;
  }
>()("reader-hero/AnnotationStore") {
  static readonly layer = Layer.effect(
    AnnotationStore,
    Effect.gen(function* () {
      const bus = yield* PubSub.unbounded<string>();

      const list = Effect.fn("AnnotationStore.list")(function* (bookId: string) {
        const rows = yield* attempt("listAnnotations", () =>
          withReaderDb((db) => db.getAll("annotations", bookKeys(bookId))),
        );
        const found: Array<Annotation> = [];

        for (const row of rows) {
          const decoded = yield* decodeAnnotation(row).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );

          if (decoded !== null) found.push(decoded);
        }

        return found.sort((a, b) => a.from.block - b.from.block || a.from.offset - b.from.offset);
      });

      const count = Effect.fn("AnnotationStore.count")(function* (bookId: string) {
        return yield* attempt("countAnnotations", () =>
          withReaderDb((db) => db.count("annotations", bookKeys(bookId))),
        );
      });

      const counts = Effect.fn("AnnotationStore.counts")(function* () {
        const keys = yield* attempt("countAnnotations", () =>
          withReaderDb((db) => db.getAllKeys("annotations")),
        );
        const found = new Map<string, number>();

        for (const key of keys) {
          const bookId = String(key).split("/")[0];

          if (bookId === undefined) continue;

          found.set(bookId, (found.get(bookId) ?? 0) + 1);
        }

        return found as ReadonlyMap<string, number>;
      });

      const listAll = Effect.fn("AnnotationStore.listAll")(function* () {
        const rows = yield* attempt("listAnnotations", () =>
          withReaderDb((db) => db.getAll("annotations")),
        );
        const found: Array<Annotation> = [];

        for (const row of rows) {
          const decoded = yield* decodeAnnotation(row).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );

          if (decoded !== null) found.push(decoded);
        }

        return found.sort((a, b) => a.from.block - b.from.block || a.from.offset - b.from.offset);
      });

      const put = Effect.fn("AnnotationStore.put")(function* (annotation: Annotation) {
        yield* attempt("putAnnotation", () =>
          withReaderDb((db) =>
            db.put("annotations", annotation, `${annotation.bookId}/${annotation.id}`),
          ),
        );
        yield* PubSub.publish(bus, annotation.bookId);
      });

      const remove = Effect.fn("AnnotationStore.remove")(function* (bookId: string, id: string) {
        yield* attempt("removeAnnotation", () =>
          withReaderDb((db) => db.delete("annotations", `${bookId}/${id}`)),
        );
        yield* PubSub.publish(bus, bookId);
      });

      const watch = (bookId: string): Stream.Stream<ReadonlyArray<Annotation>> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(bus);
            const stored = yield* list(bookId).pipe(
              Effect.catchTag("StorageFailure", () => Effect.succeed([])),
            );

            return Stream.concat(
              Stream.succeed(stored),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((changed) => changed === bookId),
                Stream.mapEffect(() =>
                  list(bookId).pipe(Effect.catchTag("StorageFailure", () => Effect.succeed([]))),
                ),
              ),
            );
          }),
        );

      const watchCounts = (): Stream.Stream<ReadonlyMap<string, number>> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(bus);
            const stored = yield* counts().pipe(
              Effect.catchTag("StorageFailure", () => Effect.succeed(new Map<string, number>())),
            );

            return Stream.concat(
              Stream.succeed(stored),
              Stream.fromSubscription(subscription).pipe(
                Stream.mapEffect(() =>
                  counts().pipe(
                    Effect.catchTag("StorageFailure", () =>
                      Effect.succeed(new Map<string, number>()),
                    ),
                  ),
                ),
              ),
            );
          }),
        );

      const watchAll = (): Stream.Stream<ReadonlyArray<Annotation>> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(bus);
            const stored = yield* listAll().pipe(
              Effect.catchTag("StorageFailure", () => Effect.succeed([])),
            );

            return Stream.concat(
              Stream.succeed(stored),
              Stream.fromSubscription(subscription).pipe(
                Stream.mapEffect(() =>
                  listAll().pipe(Effect.catchTag("StorageFailure", () => Effect.succeed([]))),
                ),
              ),
            );
          }),
        );

      return AnnotationStore.of({
        list,
        count,
        counts,
        listAll,
        put,
        remove,
        watch,
        watchCounts,
        watchAll,
      });
    }),
  );
}
