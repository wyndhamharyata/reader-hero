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

// Finished puts the saved position at the end, so the book opens there. Turned off, the book goes
// back to `place`, the position it had when the sheet opened, so a tap on and off loses nothing.
export function setBookFinished(
  bookId: string,
  finished: boolean,
  place: ReadingProgress | null,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    if (!finished) {
      yield* store.putProgress(
        bookId,
        new ReadingProgress({
          blockIndex: place?.blockIndex ?? 0,
          percent: place?.percent ?? 0,
          updatedAt: place?.updatedAt ?? 0,
          furthest: place?.furthest,
          finished: false,
        }),
      );
      return;
    }
    const previous = yield* store.getProgress(bookId);
    // A book with no parsed text has no end yet, so it keeps its position.
    const last = yield* store.getParsed(bookId).pipe(
      Effect.map((parsed) => parsed.blocks.length - 1),
      Effect.catchTags({
        BookNotFound: () => Effect.succeed(-1),
        ParsedMissing: () => Effect.succeed(-1),
      }),
    );
    yield* store.putProgress(
      bookId,
      new ReadingProgress({
        blockIndex: last < 0 ? (previous?.blockIndex ?? 0) : last,
        percent: last < 0 ? (previous?.percent ?? 0) : 1,
        updatedAt: previous?.updatedAt ?? 0,
        furthest: last < 0 ? previous?.furthest : last,
        finished: true,
      }),
    );
  });
}
