import { Effect } from "effect";
import type { StorageFailure } from "@/domain/errors";
import { ArtifactStore } from "@/services/artifact-store";
import { BookStore } from "@/services/book-store";

export function removeBook(
  id: string,
): Effect.Effect<void, StorageFailure, BookStore | ArtifactStore> {
  return Effect.gen(function* () {
    yield* (yield* BookStore).remove(id);
    yield* (yield* ArtifactStore).removeBook(id);
  });
}
