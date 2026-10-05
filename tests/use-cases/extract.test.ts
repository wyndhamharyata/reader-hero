import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { PageText, RawTextItem } from "@/domain/book";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { extractBook } from "@/use-cases/extract";

const handle: PdfHandle = { proxy: {} as never, task: {} as never, numPages: 1 };

const item = (): RawTextItem => ({
  str: "a".repeat(200),
  x: 0,
  y: 700,
  width: 100,
  height: 12,
  fontSize: 12,
  fontFamily: "",
  hasEOL: false,
});

const pageText = (page: number): PageText => ({ page, width: 600, height: 800, items: [item()] });

const stubLayer = Layer.succeed(
  PdfClient,
  PdfClient.of({
    load: () => Effect.die("not used"),
    readPage: (_handle, page) => Effect.succeed(pageText(page)),
    readPlacements: () => Effect.succeed([]),
    readImages: () => Effect.succeed([]),
    render: () => Effect.void,
    pageSizes: () => Effect.succeed([]),
    readOutline: () => Effect.succeed([]),
    release: () => Effect.void,
    pageCount: () => 1,
  }),
);

describe("extractBook", () => {
  it("given a text page, assembles text blocks without reading figures", async () => {
    const result = await Effect.runPromise(
      extractBook(handle, () => {}).pipe(Effect.provide(stubLayer)),
    );

    expect(result.scanned).toBe(false);
    expect(result.parsed.blocks.every((block) => block.kind !== "image")).toBe(true);
    expect(result.parsed.charCount).toBeGreaterThan(0);
  });
});
