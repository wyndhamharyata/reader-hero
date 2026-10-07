import { Context, Effect, Layer, PubSub, Semaphore, Stream } from "effect";
import type { Summary } from "@/domain/ai";
import { StorageFailure } from "@/domain/errors";
import { decodeSummary } from "@/lib/codecs";
import { openReaderDb } from "@/lib/db";

const attempt = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, StorageFailure> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ operation, cause }),
  });

export class SummaryStore extends Context.Service<
  SummaryStore,
  {
    get(bookId: string): Effect.Effect<Summary | null, StorageFailure>;
    // One write at a time, made from the stored record, so no writer drops another's change.
    update<S extends Summary | null>(
      bookId: string,
      change: (current: Summary | null) => S,
    ): Effect.Effect<S, StorageFailure>;
    remove(bookId: string): Effect.Effect<void, StorageFailure>;
    // Null means the summary was removed.
    changes(bookId: string): Stream.Stream<Summary | null>;
  }
>()("reader-hero/SummaryStore") {
  static readonly layer = Layer.effect(
    SummaryStore,
    Effect.gen(function* () {
      const db = yield* attempt("open", () => openReaderDb());
      const bus = yield* PubSub.unbounded<{ bookId: string; summary: Summary | null }>();
      const lock = yield* Semaphore.make(1);

      const get = Effect.fn("SummaryStore.get")(function* (bookId: string) {
        const row = yield* attempt("getSummary", () => db.get("summaries", bookId));
        if (row === undefined) return null;
        return yield* decodeSummary(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      // A null from `change` writes nothing.
      const update = <S extends Summary | null>(
        bookId: string,
        change: (current: Summary | null) => S,
      ): Effect.Effect<S, StorageFailure> =>
        Effect.gen(function* () {
          const next = change(yield* get(bookId));
          if (next === null) return next;
          yield* attempt("putSummary", () => db.put("summaries", next, bookId));
          yield* PubSub.publish(bus, { bookId, summary: next });
          return next;
        }).pipe(Semaphore.withPermit(lock));

      const remove = (bookId: string): Effect.Effect<void, StorageFailure> =>
        Effect.gen(function* () {
          yield* attempt("removeSummary", () => db.delete("summaries", bookId));
          yield* PubSub.publish(bus, { bookId, summary: null });
        }).pipe(Semaphore.withPermit(lock));

      const changes = (bookId: string) =>
        Stream.fromPubSub(bus).pipe(
          Stream.filter((change) => change.bookId === bookId),
          Stream.map((change) => change.summary),
        );

      return SummaryStore.of({ get, update, remove, changes });
    }),
  );
}
