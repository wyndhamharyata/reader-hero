import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  BookMeta,
  ImageRecord,
  type FigureState,
  type ImagePlacement,
  type PageImage,
  type PageText,
  type ParsedBook,
  type StoredImage,
} from "@/domain/book";
import { ParsedMissing } from "@/domain/errors";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { renderFigures } from "@/use-cases/render-figures";

const handle: PdfHandle = { proxy: {} as never, task: {} as never, numPages: 1 };

const placement: ImagePlacement = { id: "1-0", page: 1, x: 100, y: 400, width: 200, height: 100 };

const pageImage: PageImage = {
  ...placement,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

const pageText: PageText = {
  page: 1,
  width: 600,
  height: 800,
  items: [
    {
      str: "a".repeat(200),
      x: 0,
      y: 700,
      width: 100,
      height: 12,
      fontSize: 12,
      fontFamily: "",
      hasEOL: false,
    },
  ],
};

interface Harness {
  readonly state: {
    meta: BookMeta;
    images: StoredImage[];
    parsed: ParsedBook | null;
    renders: number;
  };
  readonly layer: Layer.Layer<BookStore | PdfClient>;
}

function harness(figures: FigureState): Harness {
  const state: Harness["state"] = {
    meta: new BookMeta({
      id: "b1",
      title: "T",
      addedAt: 0,
      fileSize: 0,
      pageCount: 1,
      parseState: "ready",
      charCount: 200,
      figures,
    }),
    images: [],
    parsed: null,
    renders: 0,
  };

  const bookStore = Layer.succeed(
    BookStore,
    BookStore.of({
      list: () => Effect.succeed([]),
      get: () => Effect.succeed(state.meta),
      putMeta: (meta) =>
        Effect.sync(() => {
          state.meta = meta;
        }),
      putFile: () => Effect.void,
      getFile: () => Effect.succeed(new Blob([new Uint8Array([1])], { type: "application/pdf" })),
      putParsed: (_id, parsed) =>
        Effect.sync(() => {
          state.parsed = parsed;
        }),
      getParsed: () =>
        state.parsed === null
          ? Effect.fail(new ParsedMissing({ id: "b1" }))
          : Effect.succeed(state.parsed),
      putImage: (_bookId, image) =>
        Effect.sync(() => {
          state.images.push(image);
        }),
      updates: () => Stream.empty,
      getImage: () => Effect.succeed(null),
      listImages: () =>
        Effect.succeed(
          state.images.map((image) => ({ id: image.id, image: new ImageRecord(image) })),
        ),
      putProgress: () => Effect.void,
      getProgress: () => Effect.succeed(null),
      remove: () => Effect.void,
      estimate: () => Effect.succeed(null),
      requestPersistent: () => Effect.succeed(false),
      takeInbox: () => Effect.succeed([]),
    }),
  );

  const pdfClient = Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: () => Effect.succeed(handle),
      readPage: () => Effect.succeed(pageText),
      readImages: () =>
        Effect.sync(() => {
          state.renders += 1;
          return [pageImage];
        }),
      render: () => Effect.void,
      pageSizes: () => Effect.succeed([]),
      readOutline: () => Effect.succeed([]),
      release: () => Effect.void,
      thumbnail: () => Effect.succeed(null),
      pageCount: () => 1,
    }),
  );

  return { state, layer: Layer.merge(bookStore, pdfClient) };
}

describe("renderFigures", () => {
  it("given pending figures, renders them, re-assembles with image blocks, and marks ready", async () => {
    const { state, layer } = harness("pending");

    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(layer)));

    expect(state.images).toHaveLength(1);
    expect(state.images[0]?.id).toBe("1-0");
    expect(state.parsed?.blocks.some((block) => block.imageId === "1-0")).toBe(true);
    expect(state.meta.figures).toBe("ready");
  });

  it("given a restarted job, resumes after the stored pages and keeps their figures", async () => {
    const first = harness("pending");
    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(first.layer)));
    const { state, layer } = harness("pending");
    state.parsed = first.state.parsed;
    state.images = first.state.images;

    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(layer)));

    expect(state.renders).toBe(0);
    expect(state.parsed?.blocks.some((block) => block.imageId === "1-0")).toBe(true);
    expect(state.parsed?.figuresThrough).toBe(1);
  });

  it("given figures already ready, does nothing", async () => {
    const { state, layer } = harness("ready");

    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(layer)));

    expect(state.images).toHaveLength(0);
    expect(state.parsed).toBeNull();
    expect(state.meta.figures).toBe("ready");
  });
});
