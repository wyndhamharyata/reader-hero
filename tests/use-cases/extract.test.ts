import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PageImage, PageText, RawTextItem } from "@/domain/book";
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

const decodedImage: PageImage = {
  id: "1-0",
  page: 1,
  x: 100,
  y: 400,
  width: 200,
  height: 100,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

const stubLayer = Layer.succeed(
  PdfClient,
  PdfClient.of({
    load: () => Effect.die("not used"),
    readPage: (_handle, page) => Effect.succeed(pageText(page)),
    readImages: () => Effect.succeed([decodedImage]),
    render: () => Effect.void,
    pageSizes: () => Effect.succeed([]),
    readOutline: () => Effect.succeed([]),
    release: () => Effect.void,
    pageCount: () => 1,
  }),
);

describe("extractBook with figures available", () => {
  it("given a text page whose figure blobs are ready, emits no image blocks", async () => {
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
