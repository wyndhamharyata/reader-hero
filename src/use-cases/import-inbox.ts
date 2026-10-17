import { Effect } from "effect";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import { addBook } from "./import-book";

let hasStarted = false;

export function importInboxOnce(): Effect.Effect<
  { readonly imported: number; readonly failure: string | null },
  never,
  BookStore | PdfClient
> {
  return Effect.gen(function* () {
    if (hasStarted) return { imported: 0, failure: null };

    hasStarted = true;

    const store = yield* BookStore;
    const entries = yield* store.inbox().pipe(Effect.catch(() => Effect.succeed([])));

    let imported = 0;
    let failure: string | null = null;

    for (const entry of entries) {
      const file = new File([entry.blob], entry.name, { type: entry.blob.type });
      const outcome = yield* addBook(file, () => {}).pipe(
        Effect.as("added" as const),
        Effect.catch((error) =>
          Effect.sync(() => {
            failure ??= describeError(error, entry.name);
            // A full store may have room next launch. A file that cannot be read never will.
            return error._tag === "StorageFailure" ? ("kept" as const) : ("dropped" as const);
          }),
        ),
      );

      if (outcome === "added") imported += 1;

      if (outcome !== "kept") {
        yield* store.removeInbox(entry.id).pipe(Effect.catch(() => Effect.void));
      }
    }

    return { imported, failure };
  });
}
