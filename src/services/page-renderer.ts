import { Context, Effect, Layer, Option, Schema } from "effect";
import type { PDFPageProxy } from "pdfjs-dist";
import { LinkTarget, type PageSize } from "@/domain/book";
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
  readonly target: LinkTarget;
}

export interface PageTextContent {
  readonly content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
  readonly rotation: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly pageX: number;
  readonly pageY: number;
}

const PageLinkSchema = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  target: LinkTarget,
});

const TextContentSchema = Schema.declare(
  (input): input is PageTextContent["content"] =>
    typeof input === "object" && input !== null && "items" in input,
);

const BitmapSchema = Schema.declare(
  (input): input is ImageBitmap =>
    typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap,
);

const OpenReply = Schema.Struct({
  id: Schema.Number,
  pageCount: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const SizeReply = Schema.Struct({ width: Schema.Number, height: Schema.Number });
const RenderReply = Schema.Struct({ bitmap: BitmapSchema });
const LinksReply = Schema.Struct({ links: Schema.Array(PageLinkSchema) });
const TextReply = Schema.Struct({
  text: Schema.Struct({
    content: TextContentSchema,
    rotation: Schema.Number,
    pageWidth: Schema.Number,
    pageHeight: Schema.Number,
    pageX: Schema.Number,
    pageY: Schema.Number,
  }),
});
const FindReply = Schema.Struct({ pages: Schema.Array(Schema.Number) });

const decodeReply = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  reply: Record<string, unknown>,
): Effect.Effect<S["Type"], PdfFailure> => {
  const decoded = Schema.decodeUnknownOption(schema)(reply);

  return Option.isNone(decoded)
    ? Effect.fail(new PdfFailure({ reason: "unknown", message: "Malformed worker reply" }))
    : Effect.succeed(decoded.value);
};

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

      // A page that left the list before its pixels came: they go back at once, not at collection.
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

// Waits for the reply. An interrupt cancels the render, or closes a document still opening.
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
    pageSize(rendered: RenderedDocument, page: number): Effect.Effect<PageSize, PdfFailure>;
    render(
      rendered: RenderedDocument,
      page: number,
      scale: number,
      crop?: PageCrop,
    ): Effect.Effect<ImageBitmap, PdfFailure>;
    links(
      rendered: RenderedDocument,
      page: number,
    ): Effect.Effect<ReadonlyArray<PageLink>, PdfFailure>;
    text(rendered: RenderedDocument, page: number): Effect.Effect<PageTextContent, PdfFailure>;
    find(
      rendered: RenderedDocument,
      pages: ReadonlyArray<number>,
      query: string,
    ): Effect.Effect<ReadonlyArray<number>, PdfFailure>;
    close(rendered: RenderedDocument): Effect.Effect<void>;
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
        Effect.flatMap(request({ type: "open", file }, [], "close"), (reply) =>
          Effect.map(decodeReply(OpenReply, reply), (opened) => ({
            id: opened.id,
            pageCount: opened.pageCount,
            first: { page: 1, width: opened.width, height: opened.height },
          })),
        ),
      pageSize: (rendered, page) =>
        Effect.flatMap(request({ type: "size", id: rendered.id, page }, [], null), (reply) =>
          Effect.map(decodeReply(SizeReply, reply), (size) => ({ page, ...size })),
        ),
      render: (rendered, page, scale, crop) =>
        Effect.flatMap(
          request({ type: "render", id: rendered.id, page, scale, crop }, [], "cancel"),
          (reply) => Effect.map(decodeReply(RenderReply, reply), (rendered) => rendered.bitmap),
        ),
      links: (rendered, page) =>
        Effect.flatMap(request({ type: "links", id: rendered.id, page }, [], null), (reply) =>
          Effect.map(decodeReply(LinksReply, reply), (links) => links.links),
        ),
      text: (rendered, page) =>
        Effect.flatMap(request({ type: "text", id: rendered.id, page }, [], null), (reply) =>
          Effect.map(decodeReply(TextReply, reply), (text) => text.text),
        ),
      find: (rendered, pages, query) =>
        Effect.flatMap(
          request({ type: "find", id: rendered.id, pages, query }, [], "cancel"),
          (reply) => Effect.map(decodeReply(FindReply, reply), (found) => found.pages),
        ),
      close: (rendered) =>
        Effect.sync(() => {
          worker().postMessage({ type: "close", id: rendered.id });
        }),
    }),
  );
}
