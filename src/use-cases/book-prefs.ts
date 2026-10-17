import { Effect } from "effect";
import { BookPrefs } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";

// Over the stored prefs, not the loaded ones, so a change made before the book loads keeps the rest.
export function saveBookPrefs(
  bookId: string,
  changes: Partial<BookPrefs>,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const stored = yield* store.getPrefs(bookId);

    yield* store.putPrefs(bookId, new BookPrefs({ ...stored, ...changes }));
  });
}
