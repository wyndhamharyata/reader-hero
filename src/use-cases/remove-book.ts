import { Effect } from "effect";
import { log } from "@/lib/log";
import { BookStore } from "@/services/book-store";

export function removeBook(id: string): Effect.Effect<void, never, BookStore> {
  return Effect.flatMap(BookStore, (store) =>
    store
      .remove(id)
      .pipe(Effect.catchTag("StorageFailure", (error) => log("book.remove-failed", error.operation))),
  );
}
