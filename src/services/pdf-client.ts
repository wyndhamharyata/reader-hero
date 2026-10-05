import { Context, Effect, Layer } from "effect";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
} from "pdfjs-dist";
import type {
  ImagePlacement,
  OutlineItem,
  PageImage,
  PageSize,
  PageText,
  RawTextItem,
} from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { log } from "@/lib/log";
import { envProbe } from "@/lib/env-probe";
import { collectImageBoxes, type ImagePaint } from "@/lib/pdf/image-boxes";
import { captureWarnings, record } from "@/lib/perf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const IMAGE_RENDER_SCALE = 1.5;
const MAX_IMAGE_DIM = 1400;
const MAX_RENDER_SIDE = 2000;
const MAX_RENDER_RATIO = 1.5;
/** Cap on waiting for an image the operator list decodes asynchronously. */
const IMAGE_LOOKUP_TIMEOUT_MS = 15000;

export interface PdfHandle {
  readonly proxy: PDFDocumentProxy;
  readonly task: PDFDocumentLoadingTask;
  readonly numPages: number;
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

const numberOrZero = (value: unknown): number => (typeof value === "number" ? value : 0);

const matrix = (
  m: ReadonlyArray<unknown>,
): readonly [number, number, number, number, number, number] => [
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
        new Promise<Blob | null>((resolve) =>
          out.toBlob((blob) => resolve(blob), "image/jpeg", 0.85),
        ),
      catch: pdfFailure,
    });
  });

/** e.g. " 2481x3508" for the largest embedded image on the page. */
const largestImageDims = (paints: ReadonlyArray<ImagePaint>): string => {
  let width = 0;
  let height = 0;
  for (const paint of paints) {
    const w = paint.imgWidth ?? 0;
    const h = paint.imgHeight ?? 0;
    if (w * h > width * height) {
      width = Math.round(w);
      height = Math.round(h);
    }
  }
  return width > 0 ? ` ${width}x${height}` : "";
};

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

interface PdfImageSource {
  readonly bitmap?: ImageBitmap;
  readonly data?: ArrayLike<number>;
  readonly kind?: number;
  readonly width?: number;
  readonly height?: number;
}

const isPdfImageSource = (source: unknown): source is PdfImageSource =>
  typeof source === "object" && source !== null;

type PdfObjectStore = {
  get(objId: string, callback?: (data: unknown) => void): unknown;
};

const tryGetObject = (objects: PdfObjectStore, name: string): unknown | undefined => {
  try {
    const data = objects.get(name);
    return data ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Waits for the pixels of an image the operator list decodes asynchronously.
 * Uses pdf.js's callback form, so the wait ends the moment the worker delivers
 * the data — no polling, and no premature fallback.
 */
const lookupImage = (pageProxy: PDFPageProxy, name: string): Effect.Effect<unknown | undefined> =>
  Effect.gen(function* () {
    const primary = name.startsWith("g_") ? pageProxy.commonObjs : pageProxy.objs;
    const secondary = name.startsWith("g_") ? pageProxy.objs : pageProxy.commonObjs;

    const settled = tryGetObject(primary, name) ?? tryGetObject(secondary, name);
    if (settled !== undefined) return settled;

    return yield* Effect.tryPromise({
      try: () =>
        new Promise<unknown | undefined>((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (done) return;
            done = true;
            resolve(undefined);
          }, IMAGE_LOOKUP_TIMEOUT_MS);
          const finish = (data: unknown): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(data);
          };
          primary.get(name, finish);
          secondary.get(name, finish);
        }),
      catch: pdfFailure,
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined)));
  });

const toImageData = (source: PdfImageSource, width: number, height: number): ImageData | null => {
  const data = source.data;
  if (data === undefined) return null;
  const expected = width * height * 4;
  if (source.kind === pdfjs.ImageKind.RGBA_32BPP) {
    // Exact RGBA arrives as a Uint8ClampedArray over a transferred plain
    // ArrayBuffer: hand a view over without copying the pixels.
    if (data instanceof Uint8ClampedArray && data.length === expected) {
      const view = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length);
      return new ImageData(view, width, height);
    }
    if (data.length === expected) {
      return new ImageData(new Uint8ClampedArray(data), width, height);
    }
    return null;
  }
  if (source.kind === pdfjs.ImageKind.RGB_24BPP) {
    const rgba = new Uint8ClampedArray(expected);
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

const decodeToBitmap = (imageData: ImageData): Effect.Effect<ImageBitmap | null> =>
  Effect.suspend(() =>
    typeof createImageBitmap === "function"
      ? Effect.tryPromise({
          try: () => createImageBitmap(imageData),
          catch: pdfFailure,
        }).pipe(Effect.catchCause(() => Effect.succeed(null)))
      : Effect.succeed(null),
  );

const encodeImage = (source: unknown): Effect.Effect<Blob | null, PdfFailure> =>
  Effect.gen(function* () {
    if (!isPdfImageSource(source)) return null;
    const width = source.width ?? 0;
    const height = source.height ?? 0;
    if (width <= 0 || height <= 0) return null;

    // A single canvas at display size; the source is scaled straight into it.
    // No full-resolution intermediate canvas, which iOS may refuse outright.
    const out = document.createElement("canvas");
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(height * scale));
    const context = out.getContext("2d");
    if (context === null) return null;

    // Matte first: JPEG has no alpha channel, so transparency becomes white,
    // which matches how the figure sits on the reader's page.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);

    if (source.bitmap instanceof ImageBitmap) {
      // The common case: pdf.js hands over a ready ImageBitmap.
      context.drawImage(source.bitmap, 0, 0, out.width, out.height);
    } else {
      const imageData = toImageData(source, width, height);
      if (imageData === null) return null;

      const decoded = yield* decodeToBitmap(imageData);
      if (decoded !== null) {
        context.drawImage(decoded, 0, 0, out.width, out.height);
        decoded.close();
      } else {
        // Engines without createImageBitmap: a native-size intermediate
        // canvas. Rare, and heavy, but correct.
        const native = document.createElement("canvas");
        native.width = width;
        native.height = height;
        const nativeContext = native.getContext("2d");
        if (nativeContext === null) return null;
        nativeContext.putImageData(imageData, 0, 0);
        context.drawImage(native, 0, 0, out.width, out.height);
      }
    }

    return yield* Effect.tryPromise({
      try: () =>
        new Promise<Blob | null>((resolve) =>
          out.toBlob((blob) => resolve(blob), "image/jpeg", 0.85),
        ),
      catch: pdfFailure,
    });
  });

/** Frees the page's operator list and decoded images once a job is done. */
const cleanupPage = (pageProxy: PDFPageProxy): Effect.Effect<void> =>
  Effect.sync(() => {
    void Promise.resolve(pageProxy.cleanup()).catch(() => {});
  });

export class PdfClient extends Context.Service<
  PdfClient,
  {
    load(data: ArrayBuffer): Effect.Effect<PdfHandle, PdfFailure>;
    readPage(handle: PdfHandle, page: number): Effect.Effect<PageText, PdfFailure>;
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
        envProbe();
        const origin = (globalThis as { location?: { origin: string } }).location?.origin ?? "";
        // Enable pdf.js's WASM decoders (JPEG 2000, JBIG2, ICC/qcms). Without a
        // served wasmUrl they silently fall back to slow pure-JS decoding.
        const task = pdfjs.getDocument({
          data,
          useWorkerFetch: true,
          wasmUrl: `${origin}/wasm/`,
          iccUrl: `${origin}/icc/`,
          // Safari exposes ImageDecoder in both contexts; make the preference
          // explicit so the JPEG fast path cannot be lost to default merging.
          isImageDecoderSupported: true,
        });
        const captured = yield* captureWarnings(
          Effect.tryPromise({ try: () => task.promise, catch: pdfFailure }),
        );
        record("pdf.load", performance.now() - started, `${captured.result.numPages} pages`);
        const fakeWorker = captured.warnings.some((warning) => /fake worker/i.test(warning));
        record("pdf.worker", 0, fakeWorker ? "FAKE (main thread)" : "worker");
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

      readImages: Effect.fn("PdfClient.readImages")(function* (handle: PdfHandle, page: number) {
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });

        const decodeStarted = performance.now();
        const captured = yield* captureWarnings(readBoxes(pageProxy, page));
        const paints = captured.result;
        if (captured.warnings.length > 0) {
          log("figures.warnings", `p${page}: ${captured.warnings.join(" | ")}`);
        }
        log(
          "figures.decode",
          `p${page}:${paints.length}${largestImageDims(paints)}`,
          performance.now() - decodeStarted,
        );
        if (paints.length === 0) {
          yield* cleanupPage(pageProxy);
          return [];
        }

        const images: PageImage[] = [];
        const undecoded: ImagePaint[] = [];
        let lookupMs = 0;
        let encodeMs = 0;

        for (const paint of paints) {
          let source: unknown;
          if (paint.inline !== undefined) source = paint.inline;
          else if (paint.name !== undefined) {
            const waitStarted = performance.now();
            source = yield* lookupImage(pageProxy, paint.name);
            lookupMs += performance.now() - waitStarted;
          }

          if (source === undefined) {
            undecoded.push(paint);
            continue;
          }
          const encodeStarted = performance.now();
          const blob = yield* encodeImage(source);
          encodeMs += performance.now() - encodeStarted;
          if (blob === null) {
            undecoded.push(paint);
            continue;
          }
          images.push({ ...paint, blob });
        }

        log("figures.lookup", `p${page}:${undecoded.length} missed`, lookupMs);
        log("figures.encode", `p${page}:${images.length}`, encodeMs);

        if (undecoded.length > 0) {
          const fallbackStarted = performance.now();
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
            for (const paint of undecoded) {
              const blob = yield* cropImage(canvas, viewport, paint);
              if (blob !== null) images.push({ ...paint, blob });
            }
          }
          canvas.width = 0;
          canvas.height = 0;
          log(
            "figures.fallback",
            `p${page}:${undecoded.length} cropped`,
            performance.now() - fallbackStarted,
          );
        }

        yield* cleanupPage(pageProxy);
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
        const sizes = yield* Effect.forEach(
          pages,
          (page) =>
            Effect.gen(function* () {
              const pageProxy = yield* Effect.tryPromise({
                try: () => handle.proxy.getPage(page),
                catch: pdfFailure,
              });
              const viewport = pageProxy.getViewport({ scale: 1 });
              return { page, width: viewport.width, height: viewport.height };
            }).pipe(Effect.option),
          { concurrency: 8 },
        );
        const readable: PageSize[] = [];
        for (const size of sizes) {
          if (size._tag === "Some") readable.push(size.value);
        }
        return readable;
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
        yield* Effect.tryPromise({
          try: () => handle.task.destroy(),
          catch: pdfFailure,
        }).pipe(Effect.catchTag("PdfFailure", () => Effect.void));
      }),

      pageCount: (handle: PdfHandle) => handle.numPages,
    }),
  );
}
