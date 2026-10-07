import { Context, Effect, Layer } from "effect";
import type { Artifact } from "@/domain/ai";
import { StorageFailure } from "@/domain/errors";
import { decodeArtifact } from "@/lib/codecs";
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
    removeBook(bookId: string): Effect.Effect<void, StorageFailure>;
  }
>()("reader-hero/ArtifactStore") {
  static readonly layer = Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const db = yield* attempt("open", () => openReaderDb());

      const get = Effect.fn("ArtifactStore.get")(function* (key: string) {
        const row = yield* attempt("getArtifact", () => db.get("artifacts", key));
        if (row === undefined) return null;
        return yield* decodeArtifact(row).pipe(Effect.catch(() => Effect.succeed(null)));
      });

      const put = Effect.fn("ArtifactStore.put")(function* (artifact: Artifact) {
        yield* attempt("putArtifact", () => db.put("artifacts", artifact));
      });

      const removeBook = Effect.fn("ArtifactStore.removeBook")(function* (bookId: string) {
        yield* attempt("removeArtifacts", async () => {
          const tx = db.transaction("artifacts", "readwrite");
          const keys = await tx.store.index("bookId").getAllKeys(bookId);
          for (const key of keys) await tx.store.delete(key);
          await tx.done;
        });
      });

      return ArtifactStore.of({ get, put, removeBook });
    }),
  );
}
