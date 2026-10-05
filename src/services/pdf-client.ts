import { Context, Effect, Layer } from "effect";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { OutlineItem, PageText, RawTextItem } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfHandle {
  readonly proxy: PDFDocumentProxy;
  readonly task: PDFDocumentLoadingTask;
  readonly numPages: number;
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

const numberOrZero = (value: unknown): number => (typeof value === "number" ? value : 0);

const matrix = (m: ReadonlyArray<unknown>): readonly [number, number, number, number, number, number] => [
  numberOrZero(m[0]),
  numberOrZero(m[1]),
  numberOrZero(m[2]),
  numberOrZero(m[3]),
  numberOrZero(m[4]),
  numberOrZero(m[5]),
];

const pdfFailure = (cause: unknown): PdfFailure => {
  const name = cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);
  if (name === "PasswordException") return new PdfFailure({ reason: "password", message });
  if (name === "InvalidPDFException") return new PdfFailure({ reason: "corrupt", message });
  return new PdfFailure({ reason: "unknown", message });
};

export class PdfClient extends Context.Service<
  PdfClient,
  {
    load(data: ArrayBuffer): Effect.Effect<PdfHandle, PdfFailure>;
    readPage(handle: PdfHandle, page: number): Effect.Effect<PageText, PdfFailure>;
    render(
      handle: PdfHandle,
      page: number,
      canvas: HTMLCanvasElement,
      scale: number,
    ): Effect.Effect<void, PdfFailure>;
    readOutline(handle: PdfHandle): Effect.Effect<ReadonlyArray<OutlineItem>, PdfFailure>;
    release(handle: PdfHandle): Effect.Effect<void>;
    pageCount(handle: PdfHandle): number;
  }
>()("reader-hero/PdfClient") {
  static readonly layer = Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: Effect.fn("PdfClient.load")(function* (data: ArrayBuffer) {
        const task = pdfjs.getDocument({ data });
        const proxy = yield* Effect.tryPromise({ try: () => task.promise, catch: pdfFailure });
        return { proxy, task, numPages: proxy.numPages };
      }),

      readPage: Effect.fn("PdfClient.readPage")(function* (handle: PdfHandle, page: number) {
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });
        const content = yield* Effect.tryPromise({
          try: () => pageProxy.getTextContent(),
          catch: pdfFailure,
        });
        const viewport = pageProxy.getViewport({ scale: 1 });

        const items: RawTextItem[] = [];
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const t = matrix(item.transform);
          const size = Math.hypot(t[2], t[3]) || item.height;
          items.push({
            str: item.str,
            x: t[4],
            y: t[5],
            width: item.width,
            height: item.height,
            fontSize: size,
            fontFamily: content.styles[item.fontName]?.fontFamily ?? "",
            hasEOL: item.hasEOL,
          });
        }

        return { page, width: viewport.width, height: viewport.height, items };
      }),

      render: Effect.fn("PdfClient.render")(
        function* (handle: PdfHandle, page: number, canvas: HTMLCanvasElement, scale: number) {
          const pageProxy = yield* Effect.tryPromise({
            try: () => handle.proxy.getPage(page),
            catch: pdfFailure,
          });
          const context = canvas.getContext("2d");
          if (context === null) {
            return yield* new PdfFailure({ reason: "unknown", message: "Canvas has no 2d context" });
          }
          const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
          const viewport = pageProxy.getViewport({ scale: scale * ratio });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          yield* Effect.tryPromise({
            try: () =>
              pageProxy.render({ canvas, canvasContext: context, viewport }).promise,
            catch: pdfFailure,
          });
        },
      ),

      readOutline: Effect.fn("PdfClient.readOutline")(function* (handle: PdfHandle) {
        const raw = yield* Effect.tryPromise({
          try: () => handle.proxy.getOutline(),
          catch: pdfFailure,
        });
        if (raw === null) return [];

        const resolvePage = (dest: unknown): Effect.Effect<number | null, PdfFailure> =>
          Effect.gen(function* () {
            if (dest === null || dest === undefined) return null;
            const resolved =
              typeof dest === "string"
                ? yield* Effect.tryPromise({
                    try: () => handle.proxy.getDestination(dest),
                    catch: pdfFailure,
                  })
                : dest;
            if (!Array.isArray(resolved) || resolved.length === 0) return null;
            const index = yield* Effect.tryPromise({
              try: () => handle.proxy.getPageIndex(resolved[0]),
              catch: pdfFailure,
            });
            return index + 1;
          });

        const walk = (
          nodes: ReadonlyArray<OutlineNode>,
          depth: number,
        ): Effect.Effect<OutlineItem[], PdfFailure> =>
          Effect.gen(function* () {
            const result: OutlineItem[] = [];
            for (const node of nodes) {
              const page = yield* resolvePage(node.dest);
              if (page !== null) result.push({ title: node.title, page, depth });
              const children = node.items as OutlineNode[];
              if (children.length > 0) result.push(...(yield* walk(children, depth + 1)));
            }
            return result;
          });

        return yield* walk(raw, 0);
      }),

      release: Effect.fn("PdfClient.release")(function* (handle: PdfHandle) {
        yield* Effect.promise(() => handle.task.destroy());
      }),

      pageCount: (handle: PdfHandle) => handle.numPages,
    }),
  );
}
