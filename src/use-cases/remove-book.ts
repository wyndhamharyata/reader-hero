import { Effect } from "effect";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";

export function removeBook(
  id: string,
): Effect.Effect<void, StorageFailure, BookStore | SummaryJobs | SummaryStore> {
  return Effect.gen(function* () {
    // The job stops first, so it sends no more of the book and writes no summary back.
    yield* (yield* SummaryJobs).stop(id);
    yield* (yield* BookStore).remove(id);
    yield* (yield* SummaryStore).remove(id);
  });
}
