import { Effect } from "effect";
import { ReadingProgress } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";

export function saveReadingProgress(
  bookId: string,
  blockIndex: number,
  total: number,
  furthest: number,
): Effect.Effect<void, never, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const previous = yield* store.getProgress(bookId);
    const percent = blockIndex / total;
    const progress = new ReadingProgress({
      blockIndex,
      percent,
      updatedAt: Date.now(),
      furthest: Math.max(furthest, blockIndex),
      finished:
        previous?.finished === false && previous.percent < 0.98 && percent >= 0.98
          ? undefined
          : previous?.finished,
    });
    yield* store.putProgress(bookId, progress);
  }).pipe(Effect.catchTag("StorageFailure", () => Effect.void));
}

export function setBookFinished(
  bookId: string,
  finished: boolean,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const previous = yield* store.getProgress(bookId);
    yield* store.putProgress(
      bookId,
      new ReadingProgress({
        blockIndex: previous?.blockIndex ?? 0,
        percent: previous?.percent ?? 0,
        updatedAt: previous?.updatedAt ?? 0,
        furthest: previous?.furthest,
        finished,
      }),
    );
  });
}
