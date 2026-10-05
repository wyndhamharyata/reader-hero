import { Effect } from "effect";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import { addPdf } from "./import-book";

let started = false;

export function importInboxOnce(): Effect.Effect<number, never, BookStore | PdfClient> {
  return Effect.gen(function* () {
    if (started) return 0;
    started = true;

    const store = yield* BookStore;
    const entries = yield* store.takeInbox().pipe(Effect.catch(() => Effect.succeed([])));

    let imported = 0;
    for (const entry of entries) {
      const file = new File([entry.blob], entry.name, { type: "application/pdf" });
      yield* addPdf(file, () => {}).pipe(
        Effect.tap(() => Effect.sync(() => (imported += 1))),
        Effect.catch(() => Effect.succeed(null)),
      );
    }

    return imported;
  });
}
