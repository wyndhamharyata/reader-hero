import { Context, Effect, Layer, PubSub, Stream } from "effect";
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
    put(summary: Summary): Effect.Effect<void, StorageFailure>;
    remove(bookId: string): Effect.Effect<void, StorageFailure>;
    // Every write, so an open reader follows the job; null means the summary was removed.
    changes(): Stream.Stream<{ readonly bookId: string; readonly summary: Summary | null }>;
  }
>()("reader-hero/SummaryStore") {
  static readonly layer = Layer.effect(
    SummaryStore,
    Effect.gen(function* () {
      const db = yield* attempt("open", () => openReaderDb());
      const bus = yield* PubSub.unbounded<{ bookId: string; summary: Summary | null }>();

      const get = Effect.fn("SummaryStore.get")(function* (bookId: string) {
        const row = yield* attempt("getSummary", () => db.get("summaries", bookId));
        if (row === undefined) return null;
        return yield* decodeSummary(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const put = Effect.fn("SummaryStore.put")(function* (next: Summary) {
        yield* attempt("putSummary", () => db.put("summaries", next, next.bookId));
        yield* PubSub.publish(bus, { bookId: next.bookId, summary: next });
      });

      const remove = Effect.fn("SummaryStore.remove")(function* (bookId: string) {
        yield* attempt("removeSummary", () => db.delete("summaries", bookId));
        yield* PubSub.publish(bus, { bookId, summary: null });
      });

      const changes = () => Stream.fromPubSub(bus);

      return SummaryStore.of({ get, put, remove, changes });
    }),
  );
}
