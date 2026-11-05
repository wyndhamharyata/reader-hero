import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PageText, RawTextItem } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { assembleExtract, extractPages } from "@/use-cases/extract";

const handle: PdfHandle = {
  proxy: {} as never,
  task: {} as never,
  numPages: 1,
  reader: {} as never,
};

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
    // Parsing must not decode figures or read links. That is the figure job's work.
    readImages: () => Effect.die("readImages called during parsing"),
    readLinks: () => Effect.die("readLinks called during parsing"),
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

    expect(result.isScanned).toBe(false);
    expect(result.parsed.blocks.some((block) => block.kind === "image")).toBe(false);
    expect(result.parsed.charCount).toBeGreaterThan(0);
  });
});

// Four pages, of which those in `bad` fail to read.
const failing = (bad: ReadonlySet<number>) =>
  Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: () => Effect.die("not used"),
      readPage: (_handle, page) =>
        bad.has(page)
          ? Effect.fail(new PdfFailure({ reason: "unknown", message: "bad page" }))
          : Effect.succeed(pageText(page)),
      readImages: () => Effect.die("not used"),
      readLinks: () => Effect.die("not used"),
      pageSize: () => Effect.die("not used"),
      readOutline: () => Effect.succeed([]),
      release: () => Effect.void,
      thumbnail: () => Effect.succeed(null),
      pageCount: () => 4,
    }),
  );

const extract = (bad: ReadonlySet<number>) =>
  Effect.runPromiseExit(
    extractPages(handle).pipe(
      Stream.runCollect,
      Effect.flatMap((pages) => assembleExtract(handle, Array.from(pages))),
      Effect.provide(failing(bad)),
    ),
  );

describe("extractPages with pages that fail", () => {
  it("given one page that fails, reads the rest", async () => {
    const exit = await extract(new Set([2]));
    expect(exit).toMatchObject({ _tag: "Success" });
  });

  it("given most pages failing, fails the file as corrupt", async () => {
    const exit = await extract(new Set([1, 2, 3]));
    expect(JSON.stringify(exit)).toContain('"reason":"corrupt"');
  });
});
