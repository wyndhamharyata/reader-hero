import { Effect } from "effect";
import type { StorageFailure } from "@/domain/errors";
import { BookStore } from "@/services/book-store";

export function removeBook(id: string): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.flatMap(BookStore, (store) => store.remove(id));
}
