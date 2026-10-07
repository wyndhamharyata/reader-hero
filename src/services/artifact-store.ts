import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { Artifact, Summary } from "@/domain/ai";
import { StorageFailure } from "@/domain/errors";
import { decodeArtifact, decodeSummary } from "@/lib/codecs";
import { openReaderDb } from "@/lib/db";

const attempt = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, StorageFailure> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ operation, cause }),
  });

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    get(key: string): Effect.Effect<Artifact | null, StorageFailure>;
    put(artifact: Artifact): Effect.Effect<void, StorageFailure>;
    summary(bookId: string): Effect.Effect<Summary | null, StorageFailure>;
    putSummary(summary: Summary): Effect.Effect<void, StorageFailure>;
    removeSummary(bookId: string): Effect.Effect<void, StorageFailure>;
    // Every summary write, so an open reader follows the job; null means the summary was removed.
    summaryChanges(): Stream.Stream<{ readonly bookId: string; readonly summary: Summary | null }>;
    removeBook(bookId: string): Effect.Effect<void, StorageFailure>;
  }
>()("reader-hero/ArtifactStore") {
  static readonly layer = Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const db = yield* attempt("open", () => openReaderDb());
      const summaryBus = yield* PubSub.unbounded<{ bookId: string; summary: Summary | null }>();

      const get = Effect.fn("ArtifactStore.get")(function* (key: string) {
        const row = yield* attempt("getArtifact", () => db.get("artifacts", key));
        if (row === undefined) return null;
        return yield* decodeArtifact(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const put = Effect.fn("ArtifactStore.put")(function* (artifact: Artifact) {
        yield* attempt("putArtifact", () => db.put("artifacts", artifact));
      });

      const summary = Effect.fn("ArtifactStore.summary")(function* (bookId: string) {
        const row = yield* attempt("getSummary", () => db.get("summaries", bookId));
        if (row === undefined) return null;
        return yield* decodeSummary(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const putSummary = Effect.fn("ArtifactStore.putSummary")(function* (next: Summary) {
        yield* attempt("putSummary", () => db.put("summaries", next, next.bookId));
        yield* PubSub.publish(summaryBus, { bookId: next.bookId, summary: next });
      });

      const removeSummary = Effect.fn("ArtifactStore.removeSummary")(function* (bookId: string) {
        yield* attempt("removeSummary", () => db.delete("summaries", bookId));
        yield* PubSub.publish(summaryBus, { bookId, summary: null });
      });

      const summaryChanges = () => Stream.fromPubSub(summaryBus);

      const removeBook = Effect.fn("ArtifactStore.removeBook")(function* (bookId: string) {
        yield* attempt("removeArtifacts", async () => {
          const tx = db.transaction("artifacts", "readwrite");
          const keys = await tx.store.index("bookId").getAllKeys(bookId);
          for (const key of keys) await tx.store.delete(key);
          await tx.done;
        });
        yield* removeSummary(bookId);
      });

      return ArtifactStore.of({
        get,
        put,
        summary,
        putSummary,
        removeSummary,
        summaryChanges,
        removeBook,
      });
    }),
  );
}
