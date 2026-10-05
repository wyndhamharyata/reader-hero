import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  BookMeta,
  type FigureState,
  type PageImage,
  type StoredImage,
} from "@/domain/book";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";
import { renderFigures } from "@/use-cases/render-figures";

const handle: PdfHandle = { proxy: {} as never, task: {} as never, numPages: 1 };

const pageImage: PageImage = {
  id: "1-0",
  page: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

interface Harness {
  readonly state: { meta: BookMeta; images: StoredImage[] };
  readonly layer: Layer.Layer<BookStore | PdfClient>;
}

function harness(figures: FigureState): Harness {
  const state = {
    meta: new BookMeta({
      id: "b1",
      title: "T",
      addedAt: 0,
      fileSize: 0,
      pageCount: 1,
      parseState: "ready",
      charCount: 10,
      figures,
    }),
    images: [] as StoredImage[],
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
      putParsed: () => Effect.void,
      getParsed: () => Effect.die("not used"),
      putImage: (_bookId, image) =>
        Effect.sync(() => {
          state.images.push(image);
        }),
      updates: () => Stream.empty,
      getImage: () => Effect.succeed(null),
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
      readPage: () => Effect.die("not used"),
      readPlacements: () => Effect.succeed([]),
      readImages: () => Effect.succeed([pageImage]),
      render: () => Effect.void,
      readOutline: () => Effect.succeed([]),
      release: () => Effect.void,
      pageCount: () => 1,
    }),
  );

  return { state, layer: Layer.merge(bookStore, pdfClient) };
}

describe("renderFigures", () => {
  it("given pending figures, stores them and marks the book ready", async () => {
    const { state, layer } = harness("pending");

    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(layer)));

    expect(state.images).toHaveLength(1);
    expect(state.images[0]?.id).toBe("1-0");
    expect(state.meta.figures).toBe("ready");
  });

  it("given figures already ready, does nothing", async () => {
    const { state, layer } = harness("ready");

    await Effect.runPromise(renderFigures("b1").pipe(Effect.provide(layer)));

    expect(state.images).toHaveLength(0);
    expect(state.meta.figures).toBe("ready");
  });
});
