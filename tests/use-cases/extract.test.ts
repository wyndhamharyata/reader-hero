import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { PageImage, PageText, RawTextItem } from "@/domain/book";
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

const coverImage: PageImage = {
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
    readPage: (_handle, page) => Effect.succeed(pageWith(page, page === 1 ? [] : [bodyItem()])),
    readImages: (_handle, page) => Effect.succeed(page === 1 ? [coverImage] : []),
    render: () => Effect.void,
    readOutline: () => Effect.succeed([]),
    release: () => Effect.void,
    pageCount: () => 2,
  }),
);

describe("extractBook", () => {
  it("given a text-less cover page, still extracts its image", async () => {
    const result = await Effect.runPromise(
      extractBook(handle, () => {}).pipe(Effect.provide(stubLayer)),
    );

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.id).toBe("1-0");
    expect(result.parsed.pageCount).toBe(2);
  });
});
