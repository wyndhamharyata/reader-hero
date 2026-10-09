import { Effect } from "effect";
import { Series } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";

export function removeBook(
  id: string,
): Effect.Effect<void, StorageFailure, BookStore | SummaryJobs | SummaryStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    // The job stops first, so it sends no more of the book and writes no summary back.
    yield* (yield* SummaryJobs).stop(id);
    for (const series of yield* store.listSeries()) {
      if (
        !series.books.some((book) => book.id === id) &&
        !series.possible.some((book) => book.id === id) &&
        !series.removed.includes(id)
      ) {
        continue;
      }
      yield* store.putSeries(
        new Series({
          ...series,
          books: series.books.filter((book) => book.id !== id),
          possible: series.possible.filter((book) => book.id !== id),
          removed: series.removed.filter((bookId) => bookId !== id),
        }),
      );
    }
    yield* store.remove(id);
    yield* (yield* SummaryStore).remove(id);
  });
}
