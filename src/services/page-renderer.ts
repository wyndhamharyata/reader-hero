import { Context, Effect, Layer } from "effect";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PageSize } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";

export interface RenderedDocument {
  readonly id: number;
  readonly pageCount: number;
  readonly first: PageSize;
}

export interface PageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// A link's box is a share of the drawn page, so it fits any width the page is shown at.
export interface PageLink {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly target: { readonly url: string } | { readonly page: number };
}

export interface PageTextContent {
  readonly content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
  readonly rotation: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly pageX: number;
  readonly pageY: number;
}

let renderer: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (reply: Record<string, unknown>) => void>();

const worker = (): Worker => {
  if (renderer === null) {
    renderer = new Worker(new URL("../workers/pdf-render.ts", import.meta.url), {
      type: "module",
    });
    const current = renderer;
    current.onmessage = (event: MessageEvent) => {
      const reply = event.data as Record<string, unknown>;
      const key = typeof reply.requestId === "number" ? reply.requestId : reply.id;
      if (typeof key !== "number") return;
      const settle = pending.get(key);
      pending.delete(key);
      // A page that left the list before its pixels came: they go back now, not at collection.
      if (settle === undefined) {
        if (reply.bitmap instanceof ImageBitmap) reply.bitmap.close();
        return;
      }
      settle(reply);
    };
    // Dropped, so the next request starts a new worker instead of waiting forever.
    current.onerror = () => {
      for (const settle of pending.values()) settle({ type: "error", message: "Worker failed" });
      pending.clear();
      current.terminate();
      if (renderer === current) renderer = null;
    };
  }
  return renderer;
};

// Waits for the reply; an interrupt cancels the render, or closes a document still opening.
const request = (
  body: Record<string, unknown>,
  transfer: Transferable[],
  onInterrupt: "cancel" | "close" | null,
): Effect.Effect<Record<string, unknown>, PdfFailure> =>
  Effect.callback((resume) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, (reply) => {
      if (reply.type === "error") {
        resume(Effect.fail(new PdfFailure({ reason: "unknown", message: String(reply.message) })));
      } else {
        resume(Effect.succeed(reply));
      }
    });
    worker().postMessage({ ...body, requestId: id, id: body.id ?? id }, transfer);
    return Effect.sync(() => {
      if (!pending.delete(id)) return;
      if (onInterrupt === "cancel") worker().postMessage({ type: "cancel", requestId: id });
      if (onInterrupt === "close") worker().postMessage({ type: "close", id });
    });
  });

export class PageRenderer extends Context.Service<
  PageRenderer,
  {
    // Loads both worker scripts ahead of the first open.
    warm(): Effect.Effect<void>;
    open(file: Blob): Effect.Effect<RenderedDocument, PdfFailure>;
    pageSize(doc: RenderedDocument, page: number): Effect.Effect<PageSize, PdfFailure>;
    render(
      doc: RenderedDocument,
      page: number,
      scale: number,
      crop?: PageCrop,
    ): Effect.Effect<ImageBitmap, PdfFailure>;
    links(doc: RenderedDocument, page: number): Effect.Effect<ReadonlyArray<PageLink>, PdfFailure>;
    text(doc: RenderedDocument, page: number): Effect.Effect<PageTextContent, PdfFailure>;
    find(
      doc: RenderedDocument,
      pages: ReadonlyArray<number>,
      query: string,
    ): Effect.Effect<ReadonlyArray<number>, PdfFailure>;
    close(doc: RenderedDocument): Effect.Effect<void>;
  }
>()("reader-hero/PageRenderer") {
  static readonly layer = Layer.succeed(
    PageRenderer,
    PageRenderer.of({
      warm: () =>
        Effect.sync(() => {
          worker().postMessage({ type: "warm" });
        }),
      open: (file) =>
        Effect.map(request({ type: "open", file }, [], "close"), (reply) => ({
          id: Number(reply.id),
          pageCount: Number(reply.pageCount),
          first: { page: 1, width: Number(reply.width), height: Number(reply.height) },
        })),
      pageSize: (doc, page) =>
        Effect.map(request({ type: "size", id: doc.id, page }, [], null), (reply) => ({
          page,
          width: Number(reply.width),
          height: Number(reply.height),
        })),
      render: (doc, page, scale, crop) =>
        Effect.map(
          request({ type: "render", id: doc.id, page, scale, crop }, [], "cancel"),
          (reply) => reply.bitmap as ImageBitmap,
        ),
      links: (doc, page) =>
        Effect.map(
          request({ type: "links", id: doc.id, page }, [], null),
          (reply) => reply.links as ReadonlyArray<PageLink>,
        ),
      text: (doc, page) =>
        Effect.map(
          request({ type: "text", id: doc.id, page }, [], null),
          (reply) => reply.text as PageTextContent,
        ),
      find: (doc, pages, query) =>
        Effect.map(
          request({ type: "find", id: doc.id, pages, query }, [], null),
          (reply) => reply.pages as ReadonlyArray<number>,
        ),
      close: (doc) =>
        Effect.sync(() => {
          worker().postMessage({ type: "close", id: doc.id });
        }),
    }),
  );
}
