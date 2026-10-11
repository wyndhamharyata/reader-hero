import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BookMeta, ImageRecord, type StoredImage } from "@/domain/book";
import { PdfClient } from "@/services/pdf-client";
import { resetBookCover, setBookCover } from "@/use-cases/book-image";
import { bookStore } from "../_support/book-store";

// Node has no canvas, so the shrink returns the picture as it came, at a fixed size.
vi.mock("@/lib/picture", () => ({
  shrinkPicture: (picture: Blob) =>
    Effect.succeed(picture.size === 0 ? null : { blob: picture, width: 400, height: 600 }),
}));

const meta = (fields: Partial<BookMeta> = {}) =>
  new BookMeta({
    id: "b1",
    title: "Salt Memory",
    addedAt: 0,
    fileSize: 1,
    pageCount: 3,
    parseState: "ready",
    charCount: 40,
    format: "pdf",
    ...fields,
  });

const picture = (text: string): Blob => new Blob([text], { type: "image/png" });

function harness(book: BookMeta, images: Record<string, Blob>) {
  const state = { meta: book, images: new Map(Object.entries(images)), rendered: 0 };
  const store = bookStore({
    get: () => Effect.sync(() => state.meta),
    putMeta: (next) =>
      Effect.sync(() => {
        state.meta = next;
      }),
    getImage: (_bookId, id) =>
      Effect.sync(() => {
        const blob = state.images.get(id);
        return blob === undefined ? null : new ImageRecord({ blob, width: 400, height: 600 });
      }),
    putImage: (_bookId, image: StoredImage) =>
      Effect.sync(() => {
        state.images.set(image.id, image.blob);
      }),
    removeImage: (_bookId, id) =>
      Effect.sync(() => {
        state.images.delete(id);
      }),
    getFile: () => Effect.succeed(new Blob(["%PDF"])),
  });
  // The first page renders as the cover, as on a new import.
  const pdf = Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: () => Effect.succeed({} as never),
      thumbnail: () =>
        Effect.sync(() => {
          state.rendered += 1;
          return { blob: picture("page one"), width: 400, height: 600 };
        }),
      release: () => Effect.void,
    } as unknown as Parameters<typeof PdfClient.of>[0]),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
  return { state, layer: Layer.mergeAll(store, pdf), run };
}

const text = (blob: Blob | undefined) => blob?.text();

describe("book cover", () => {
  it("given a picture, makes it the cover and keeps the book's own for Reset", async () => {
    const { state, layer, run } = harness(meta(), { cover: picture("own") });

    expect(await run(setBookCover("b1", picture("mine")).pipe(Effect.provide(layer)))).toBe(true);

    expect(await text(state.images.get("cover"))).toBe("mine");
    expect(await text(state.images.get("cover-default"))).toBe("own");
    expect(state.meta.customCover).toBe(true);
  });

  it("given a second picture, keeps the book's own, not the first picture", async () => {
    const { state, layer, run } = harness(meta(), { cover: picture("own") });
    await run(setBookCover("b1", picture("first")).pipe(Effect.provide(layer)));
    await run(setBookCover("b1", picture("second")).pipe(Effect.provide(layer)));

    expect(await text(state.images.get("cover"))).toBe("second");
    expect(await text(state.images.get("cover-default"))).toBe("own");
  });

  it("given a picture that does not decode, leaves the cover as it was", async () => {
    const { state, layer, run } = harness(meta(), { cover: picture("own") });

    expect(await run(setBookCover("b1", new Blob([])).pipe(Effect.provide(layer)))).toBe(false);

    expect(await text(state.images.get("cover"))).toBe("own");
    expect(state.images.has("cover-default")).toBe(false);
    expect(state.meta.customCover).toBeUndefined();
  });

  it("given Reset, brings the book's own cover back and drops the kept copy", async () => {
    const { state, layer, run } = harness(meta(), { cover: picture("own") });
    await run(setBookCover("b1", picture("mine")).pipe(Effect.provide(layer)));
    await run(resetBookCover("b1").pipe(Effect.provide(layer)));

    expect(await text(state.images.get("cover"))).toBe("own");
    expect(state.images.has("cover-default")).toBe(false);
    expect(state.meta.customCover).toBeUndefined();
    expect(state.rendered).toBe(0);
  });

  it("given Reset on a PDF that had no cover yet, renders its first page", async () => {
    const { state, layer, run } = harness(meta(), {});
    await run(setBookCover("b1", picture("mine")).pipe(Effect.provide(layer)));
    await run(resetBookCover("b1").pipe(Effect.provide(layer)));

    expect(await text(state.images.get("cover"))).toBe("page one");
    expect(state.rendered).toBe(1);
  });
});
