import { Context, Effect, Layer } from "effect";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
} from "pdfjs-dist";
import type { ImagePlacement, OutlineItem, PageImage, PageSize, PageText, RawTextItem } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { collectImageBoxes, type ImagePaint } from "@/lib/pdf/image-boxes";
import { captureWarnings, record } from "@/lib/perf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const IMAGE_RENDER_SCALE = 1.5;
const MAX_IMAGE_DIM = 1400;
const MAX_RENDER_SIDE = 2000;
const MAX_RENDER_RATIO = 1.5;

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

const cropImage = (
  source: HTMLCanvasElement,
  viewport: PageViewport,
  box: ImagePlacement,
): Effect.Effect<Blob | null, PdfFailure> =>
  Effect.gen(function* () {
    const a = viewport.convertToViewportPoint(box.x, box.y);
    const b = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
    const left = Math.max(0, Math.floor(Math.min(Number(a[0]), Number(b[0]))));
    const top = Math.max(0, Math.floor(Math.min(Number(a[1]), Number(b[1]))));
    const right = Math.min(viewport.width, Math.ceil(Math.max(Number(a[0]), Number(b[0]))));
    const bottom = Math.min(viewport.height, Math.ceil(Math.max(Number(a[1]), Number(b[1]))));
    const width = right - left;
    const height = bottom - top;
    if (width < 4 || height < 4) return null;

    const out = document.createElement("canvas");
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(height * scale));
    const context = out.getContext("2d");
    if (context === null) return null;
    context.drawImage(source, left, top, width, height, 0, 0, out.width, out.height);

    return yield* Effect.tryPromise({
      try: () =>
        new Promise<Blob | null>((resolve) => out.toBlob((blob) => resolve(blob), "image/png")),
      catch: pdfFailure,
    });
  });

const readBoxes = (
  pageProxy: PDFPageProxy,
  page: number,
): Effect.Effect<ReadonlyArray<ImagePaint>, PdfFailure> =>
  Effect.gen(function* () {
    const opList = yield* Effect.tryPromise({
      try: () => pageProxy.getOperatorList(),
      catch: pdfFailure,
    });
    return collectImageBoxes(
      { fnArray: opList.fnArray, argsArray: opList.argsArray },
      page,
      pdfjs.OPS,
      pdfjs.Util,
    );
  });

const readImageData = (pageProxy: PDFPageProxy, name: string): unknown | undefined => {
  const objects = name.startsWith("g_") ? pageProxy.commonObjs : pageProxy.objs;
  try {
    const data = objects.get(name);
    return data ?? undefined;
  } catch {
    return undefined;
  }
};

/** Waits briefly for image objects the operator list loads asynchronously. */
const lookupImage = (
  pageProxy: PDFPageProxy,
  name: string,
): Effect.Effect<unknown | undefined> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const data = readImageData(pageProxy, name);
      if (data !== undefined) return data;
      yield* Effect.sleep("50 millis");
    }
    return undefined;
  });

const toImageData = (
  source: { readonly data?: Uint8ClampedArray; readonly kind?: number },
  width: number,
  height: number,
): ImageData | null => {
  const data = source.data;
  if (data === undefined) return null;
  if (source.kind === pdfjs.ImageKind.RGBA_32BPP) {
    return new ImageData(new Uint8ClampedArray(data), width, height);
  }
  if (source.kind === pdfjs.ImageKind.RGB_24BPP) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    let src = 0;
    for (let dest = 0; dest < rgba.length; dest += 4) {
      rgba[dest] = data[src] ?? 0;
      rgba[dest + 1] = data[src + 1] ?? 0;
      rgba[dest + 2] = data[src + 2] ?? 0;
      rgba[dest + 3] = 255;
      src += 3;
    }
    return new ImageData(rgba, width, height);
  }
  return null;
};

const encodeImage = async (source: unknown): Promise<Blob | null> => {
  const image = source as {
    bitmap?: unknown;
    data?: Uint8ClampedArray;
    kind?: number;
    width?: number;
    height?: number;
  };
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  if (width <= 0 || height <= 0) return null;

  const native = document.createElement("canvas");
  native.width = width;
  native.height = height;
  const nativeContext = native.getContext("2d");
  if (nativeContext === null) return null;

  if (image.bitmap instanceof ImageBitmap) {
    nativeContext.drawImage(image.bitmap, 0, 0);
  } else {
    const imageData = toImageData(image, width, height);
    if (imageData === null) return null;
    nativeContext.putImageData(imageData, 0, 0);
  }

  const out = document.createElement("canvas");
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const outContext = out.getContext("2d");
  if (outContext === null) return null;
  outContext.drawImage(native, 0, 0, out.width, out.height);

  const mayHaveAlpha = image.bitmap !== undefined || image.kind === pdfjs.ImageKind.RGBA_32BPP;
  const type = mayHaveAlpha ? "image/png" : "image/jpeg";
  return await new Promise<Blob | null>((resolve) =>
    out.toBlob((blob) => resolve(blob), type, type === "image/jpeg" ? 0.85 : undefined),
  );
};

export class PdfClient extends Context.Service<
  PdfClient,
  {
    load(data: ArrayBuffer): Effect.Effect<PdfHandle, PdfFailure>;
    readPage(handle: PdfHandle, page: number): Effect.Effect<PageText, PdfFailure>;
    readPlacements(
      handle: PdfHandle,
      page: number,
    ): Effect.Effect<ReadonlyArray<ImagePlacement>, PdfFailure>;
    readImages(handle: PdfHandle, page: number): Effect.Effect<ReadonlyArray<PageImage>, PdfFailure>;
    render(
      handle: PdfHandle,
      page: number,
      canvas: HTMLCanvasElement,
      scale: number,
    ): Effect.Effect<void, PdfFailure>;
    pageSizes(handle: PdfHandle): Effect.Effect<ReadonlyArray<PageSize>, PdfFailure>;
    readOutline(handle: PdfHandle): Effect.Effect<ReadonlyArray<OutlineItem>, PdfFailure>;
    release(handle: PdfHandle): Effect.Effect<void>;
    pageCount(handle: PdfHandle): number;
  }
>()("reader-hero/PdfClient") {
  static readonly layer = Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: Effect.fn("PdfClient.load")(function* (data: ArrayBuffer) {
        const started = performance.now();
        const task = pdfjs.getDocument({ data });
        const captured = yield* Effect.tryPromise({
          try: () => captureWarnings(() => task.promise),
          catch: pdfFailure,
        });
        record("pdf.load", performance.now() - started, `${captured.result.numPages} pages`);
        record(
          "pdf.worker",
          0,
          captured.warnings.some((warning) => /fake worker/i.test(warning))
            ? "FAKE (main thread)"
            : "worker",
        );
        return { proxy: captured.result, task, numPages: captured.result.numPages };
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

      readPlacements: Effect.fn("PdfClient.readPlacements")(
        function* (handle: PdfHandle, page: number) {
          const pageProxy = yield* Effect.tryPromise({
            try: () => handle.proxy.getPage(page),
            catch: pdfFailure,
          });
          return yield* readBoxes(pageProxy, page);
        },
      ),

      readImages: Effect.fn("PdfClient.readImages")(function* (handle: PdfHandle, page: number) {
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });
        const opList = yield* Effect.tryPromise({
          try: () => pageProxy.getOperatorList(),
          catch: pdfFailure,
        });
        const paints = collectImageBoxes(
          { fnArray: opList.fnArray, argsArray: opList.argsArray },
          page,
          pdfjs.OPS,
          pdfjs.Util,
        );
        if (paints.length === 0) return [];

        const images: PageImage[] = [];
        const missing: ImagePaint[] = [];

        // Fast path: the operator list already decoded these images.
        for (const paint of paints) {
          let source: unknown;
          if (paint.inline !== undefined) source = paint.inline;
          else if (paint.name !== undefined) source = yield* lookupImage(pageProxy, paint.name);

          if (source === undefined) {
            missing.push(paint);
            continue;
          }
          const blob = yield* Effect.tryPromise({
            try: () => encodeImage(source),
            catch: pdfFailure,
          });
          if (blob === null) {
            missing.push(paint);
            continue;
          }
          images.push({ ...paint, blob });
        }

        // Fallback: rasterize the page once and crop what could not be decoded.
        if (missing.length > 0) {
          const base = pageProxy.getViewport({ scale: 1 });
          const renderScale = Math.min(
            IMAGE_RENDER_SCALE,
            MAX_RENDER_SIDE / Math.max(base.width, base.height, 1),
          );
          const viewport = pageProxy.getViewport({ scale: renderScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context = canvas.getContext("2d");
          if (context !== null) {
            yield* Effect.tryPromise({
              try: () => pageProxy.render({ canvas, canvasContext: context, viewport }).promise,
              catch: pdfFailure,
            });
            for (const paint of missing) {
              const blob = yield* cropImage(canvas, viewport, paint);
              if (blob !== null) images.push({ ...paint, blob });
            }
          }
          canvas.width = 0;
          canvas.height = 0;
        }

        return images;
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
          const ratio = Math.min(MAX_RENDER_RATIO, globalThis.devicePixelRatio || 1);
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

      pageSizes: Effect.fn("PdfClient.pageSizes")(function* (handle: PdfHandle) {
        const pages = Array.from({ length: handle.numPages }, (_, index) => index + 1);
        return yield* Effect.forEach(
          pages,
          (page) =>
            Effect.gen(function* () {
              const pageProxy = yield* Effect.tryPromise({
                try: () => handle.proxy.getPage(page),
                catch: pdfFailure,
              });
              const viewport = pageProxy.getViewport({ scale: 1 });
              return { page, width: viewport.width, height: viewport.height };
            }).pipe(
              Effect.catchCause(() => Effect.succeed({ page, width: 612, height: 792 })),
            ),
          { concurrency: 8 },
        );
      }),

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
