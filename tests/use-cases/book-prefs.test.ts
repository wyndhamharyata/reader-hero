import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { BookPrefs } from "@/domain/book";
import { saveBookPrefs } from "@/use-cases/book-prefs";
import { bookStore } from "../_support/book-store";

describe("saveBookPrefs", () => {
  it("given a change before the book loads, keeps the stored prefs it does not touch", async () => {
    let saved: BookPrefs | null = null;
    const store = bookStore({
      getPrefs: () => Effect.succeed(new BookPrefs({ mode: "original", kind: "story" })),
      putPrefs: (_id, prefs) =>
        Effect.sync(() => {
          saved = prefs;
        }),
    });
    await Effect.runPromise(saveBookPrefs("b1", { fontSize: 20 }).pipe(Effect.provide(store)));
    expect(saved).toMatchObject({ mode: "original", kind: "story", fontSize: 20 });
  });
});
