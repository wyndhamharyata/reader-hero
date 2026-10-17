import { Context, Effect, Layer } from "effect";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PageSize } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";

export interface RenderedDocument {
  readonly id: number;
  readonly pageCount: number;
  readonly first: PageSize;
}

// A part of the page in device pixels at the scale it is drawn at.
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

// pdf.js's text content, with the page's own box, which its text layer places text in.
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
    renderer.onmessage = (event: MessageEvent) => {
      const reply = event.data as Record<string, unknown>;
      const key = typeof reply.requestId === "number" ? reply.requestId : reply.id;
      if (typeof key !== "number") return;
      pending.get(key)?.(reply);
      pending.delete(key);
    };
    renderer.onerror = () => {
      for (const settle of pending.values()) settle({ type: "error", message: "Worker failed" });
      pending.clear();
    };
  }
  return renderer;
};

// Posts one request and waits for its reply; an interrupted wait tells the worker to stop.
const request = (
  body: Record<string, unknown>,
  transfer: Transferable[],
  cancel: boolean,
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
      if (pending.delete(id) && cancel) worker().postMessage({ type: "cancel", requestId: id });
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
        Effect.map(request({ type: "open", file }, [], false), (reply) => ({
          id: Number(reply.id),
          pageCount: Number(reply.pageCount),
          first: { page: 1, width: Number(reply.width), height: Number(reply.height) },
        })),
      pageSize: (doc, page) =>
        Effect.map(request({ type: "size", id: doc.id, page }, [], false), (reply) => ({
          page,
          width: Number(reply.width),
          height: Number(reply.height),
        })),
      render: (doc, page, scale, crop) =>
        Effect.map(
          request({ type: "render", id: doc.id, page, scale, crop }, [], true),
          (reply) => reply.bitmap as ImageBitmap,
        ),
      links: (doc, page) =>
        Effect.map(
          request({ type: "links", id: doc.id, page }, [], false),
          (reply) => reply.links as ReadonlyArray<PageLink>,
        ),
      text: (doc, page) =>
        Effect.map(
          request({ type: "text", id: doc.id, page }, [], false),
          (reply) => reply.text as PageTextContent,
        ),
      close: (doc) =>
        Effect.sync(() => {
          worker().postMessage({ type: "close", id: doc.id });
        }),
    }),
  );
}
