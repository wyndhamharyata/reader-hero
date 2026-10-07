import { Effect } from "effect";
import { ReadingProgress } from "@/domain/book";
import { BookStore } from "@/services/book-store";

export function saveReadingProgress(
  bookId: string,
  blockIndex: number,
  total: number,
  furthest: number,
): Effect.Effect<void, never, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const progress = new ReadingProgress({
      blockIndex,
      percent: blockIndex / total,
      updatedAt: Date.now(),
      furthest: Math.max(furthest, blockIndex),
    });
    yield* store
      .putProgress(bookId, progress)
      .pipe(Effect.catchTag("StorageFailure", () => Effect.void));
  });
}
