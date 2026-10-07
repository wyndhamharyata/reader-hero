import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PageText, RawTextItem } from "@/domain/book";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { assembleExtract, extractPages } from "@/use-cases/extract";

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
    // Parsing must not decode figures; that is the figure job's work.
    readImages: () => Effect.die("readImages called during parsing"),
    pageSize: () => Effect.die("not used"),
    readOutline: () => Effect.succeed([]),
    release: () => Effect.void,
    thumbnail: () => Effect.succeed(null),
    pageCount: () => 1,
  }),
);

describe("extractPages and assembleExtract", () => {
  it("given text pages, reads text without decoding figure images", async () => {
    const pages = await Effect.runPromise(
      extractPages(handle).pipe(Stream.runCollect, Effect.provide(stubLayer)),
    );
    const result = await Effect.runPromise(
      assembleExtract(handle, Array.from(pages)).pipe(Effect.provide(stubLayer)),
    );

    expect(result.scanned).toBe(false);
    expect(result.parsed.blocks.some((block) => block.kind === "image")).toBe(false);
    expect(result.parsed.charCount).toBeGreaterThan(0);
  });
});
