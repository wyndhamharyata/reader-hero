import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { BookMeta } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { PdfClient } from "@/services/pdf-client";
import { importBooks } from "@/use-cases/import-books";
import { bookStore } from "../_support/book-store";

const held = new BookMeta({
  id: "b1",
  title: "Mixed Sizes",
  addedAt: 0,
  fileSize: 100,
  pageCount: 3,
  parseState: "ready",
  charCount: 40,
  fileName: "mixed.pdf",
  format: "pdf",
});

const file = (name: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

const pdf = (onLoad: () => void): Layer.Layer<PdfClient> =>
  Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: () => {
        onLoad();
        return Effect.fail(new PdfFailure({ reason: "corrupt", message: "Boom" }));
      },
    } as unknown as Parameters<typeof PdfClient.of>[0]),
  );

describe("importBooks", () => {
  it("given a file the library already holds, adds nothing and says which one", async () => {
    const messages: string[] = [];
    let loaded = 0;
    const layer = bookStore({
      list: () => Effect.succeed([held]),
      requestPersistent: () => Effect.succeed(true),
    });

    await Effect.runPromise(
      importBooks(
        [file("mixed.pdf", 100)],
        () => {},
        (message) => messages.push(message),
      ).pipe(Effect.provide(layer), Effect.provide(pdf(() => (loaded += 1)))),
    );

    expect(loaded).toBe(0);
    expect(messages.join("\n")).toContain("Added 0 of 1 books.");
    expect(messages.join("\n")).toContain("Already in the library: mixed.pdf.");
  });

  it("given the same name with another size, imports it, as a different book would", async () => {
    const messages: string[] = [];
    let loaded = 0;
    const layer = bookStore({
      list: () => Effect.succeed([held]),
      requestPersistent: () => Effect.succeed(true),
    });

    await Effect.runPromise(
      importBooks(
        [file("mixed.pdf", 200)],
        () => {},
        (message) => messages.push(message),
      ).pipe(Effect.provide(layer), Effect.provide(pdf(() => (loaded += 1)))),
    );

    expect(loaded).toBe(1);
    expect(messages.join("\n")).not.toContain("Already in the library");
  });
});
