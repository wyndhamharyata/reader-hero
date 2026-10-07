import { Effect } from "effect";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { SummaryStore } from "@/services/summary-store";

export function removeBook(
  id: string,
): Effect.Effect<void, StorageFailure, BookStore | SummaryStore> {
  return Effect.gen(function* () {
    yield* (yield* BookStore).remove(id);
    yield* (yield* SummaryStore).remove(id);
  });
}
