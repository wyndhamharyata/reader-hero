import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { PdfClient } from "@/services/pdf-client";
import { bookStore } from "../_support/book-store";

// The import runs once per page load, so each test loads the module afresh.
async function run(entries: ReadonlyArray<{ id: number; name: string; blob: Blob }>) {
  vi.resetModules();
  const { importInboxOnce } = await import("@/use-cases/import-inbox");
  const removed: number[] = [];
  const store = bookStore({
    inbox: () => Effect.succeed(entries.map((entry) => ({ ...entry, addedAt: 0 }))),
    removeInbox: (id) => Effect.sync(() => void removed.push(id)),
  });
  const result = await Effect.runPromise(
    importInboxOnce().pipe(
      Effect.provide(Layer.merge(store, Layer.succeed(PdfClient, {} as never))),
    ),
  );
  return { result, removed };
}

describe("importInboxOnce", () => {
  it("given a shared file that is not a book, removes it and says why", async () => {
    const { result, removed } = await run([
      { id: 7, name: "notes.txt", blob: new Blob(["hi"], { type: "text/plain" }) },
    ]);
    expect(result).toEqual({ imported: 0, failure: "notes.txt is not a PDF or EPUB." });
    expect(removed).toEqual([7]);
  });

  it("given an empty inbox, does nothing", async () => {
    const { result, removed } = await run([]);
    expect(result).toEqual({ imported: 0, failure: null });
    expect(removed).toEqual([]);
  });
});
