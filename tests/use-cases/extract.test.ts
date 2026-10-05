import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { ImagePlacement, PageText, RawTextItem } from "@/domain/book";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { extractBook } from "@/use-cases/extract";

const handle: PdfHandle = { proxy: {} as never, task: {} as never, numPages: 2 };

const bodyItem = (): RawTextItem => ({
  str: "a".repeat(200),
  x: 0,
  y: 700,
  width: 300,
  height: 12,
  fontSize: 12,
  fontFamily: "",
  hasEOL: false,
});

const pageWith = (page: number, items: ReadonlyArray<RawTextItem>): PageText => ({
  page,
  width: 600,
  height: 800,
  items,
});

const cover: ImagePlacement = { id: "1-0", page: 1, x: 100, y: 400, width: 200, height: 100 };

const stubLayer = Layer.succeed(
  PdfClient,
  PdfClient.of({
    load: () => Effect.die("not used"),
    readPage: (_handle, page) => Effect.succeed(pageWith(page, page === 1 ? [] : [bodyItem()])),
    readPlacements: (_handle, page) => Effect.succeed(page === 1 ? [cover] : []),
    readImages: () => Effect.succeed([]),
    render: () => Effect.void,
    readOutline: () => Effect.succeed([]),
    release: () => Effect.void,
    pageCount: () => 2,
  }),
);

describe("extractBook", () => {
  it("given a text-less cover page, places its figure without rendering it", async () => {
    const result = await Effect.runPromise(
      extractBook(handle, () => {}).pipe(Effect.provide(stubLayer)),
    );

    expect(result.hasFigures).toBe(true);
    const imageBlock = result.parsed.blocks.find((block) => block.kind === "image");
    expect(imageBlock?.imageId).toBe("1-0");
    expect(result.parsed.pageCount).toBe(2);
  });
});
