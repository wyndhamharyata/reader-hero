import { Context, Effect, Layer, Schema, Stream } from "effect";
import * as pdfjs from "pdfjs-dist";
const workerUrl = "/worker/pdf.worker.shimmed.min.mjs";
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
import { collectImageBoxes, imagePayloadFields, type ImagePaint } from "@/lib/pdf/image-boxes";
import { captureWarnings, record } from "@/lib/perf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const IMAGE_RENDER_SCALE = 1.5;
const MAX_IMAGE_DIM = 1400;
const MAX_RENDER_SIDE = 2000;
const MAX_RENDER_RATIO = 1.5;
const IMAGE_LOOKUP_TIMEOUT = "15 seconds";
const PAINT_CONCURRENCY = 2;
const CROP_CONCURRENCY = 2;

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

const PdfImagePayload = Schema.Struct({
  ...imagePayloadFields,
  kind: Schema.optional(Schema.Number),
});

const toJpegBlob = (canvas: HTMLCanvasElement): Effect.Effect<Blob | null, PdfFailure> =>
  Effect.tryPromise({
    try: () =>
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85),
      ),
    catch: pdfFailure,
  });

const clampView = (bytes: Uint8ClampedArray | Uint8Array): Uint8ClampedArray<ArrayBuffer> =>
  bytes instanceof Uint8ClampedArray && bytes.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length)
    : Uint8ClampedArray.from(bytes);

const pixelBytes = (value: unknown): Uint8ClampedArray | Uint8Array | undefined =>
  value instanceof Uint8ClampedArray || value instanceof Uint8Array ? value : undefined;

const toImageData = (
  bytes: Uint8ClampedArray | Uint8Array,
  kind: number | undefined,
  width: number,
  height: number,
): ImageData | null => {
  const expected = width * height * 4;
  if (kind === pdfjs.ImageKind.RGBA_32BPP && bytes.length === expected) {
    return new ImageData(clampView(bytes), width, height);
  }
  if (kind === pdfjs.ImageKind.RGB_24BPP) {
    const rgba = new Uint8ClampedArray(expected);
    let src = 0;
    for (let dest = 0; dest < rgba.length; dest += 4) {
      rgba[dest] = bytes[src] ?? 0;
      rgba[dest + 1] = bytes[src + 1] ?? 0;
      rgba[dest + 2] = bytes[src + 2] ?? 0;
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
        }).pipe(Effect.catchTag("PdfFailure", () => Effect.succeed(null)))
      : Effect.succeed(null),
  );

const paintOnCanvas = (
  context: CanvasRenderingContext2D,
  image: typeof PdfImagePayload.Type,
  width: number,
  height: number,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);

    const bitmap = image.bitmap;
    if (bitmap instanceof ImageBitmap) {
      context.drawImage(bitmap, 0, 0, context.canvas.width, context.canvas.height);
      return true;
    }

    const bytes = pixelBytes(image.data);
    if (bytes === undefined) return false;
    const imageData = toImageData(bytes, image.kind, width, height);
    if (imageData === null) return false;

    const decoded = yield* decodeToBitmap(imageData);
    if (decoded !== null) {
      context.drawImage(decoded, 0, 0, context.canvas.width, context.canvas.height);
      decoded.close();
      return true;
    }

    const native = document.createElement("canvas");
    native.width = width;
    native.height = height;
    const nativeContext = native.getContext("2d");
    if (nativeContext === null) return false;
    nativeContext.putImageData(imageData, 0, 0);
    context.drawImage(native, 0, 0, context.canvas.width, context.canvas.height);
    return true;
  });

const encodeImage = (source: unknown): Effect.Effect<Blob | null, PdfFailure> =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(PdfImagePayload)(source);
    if (decoded._tag === "None") return null;
    const image = decoded.value;
    const width = image.width;
    const height = image.height;
    if (width <= 0 || height <= 0) return null;

    const out = document.createElement("canvas");
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(height * scale));
    const context = out.getContext("2d");
    if (context === null) return null;

    const painted = yield* paintOnCanvas(context, image, width, height);
    if (!painted) return null;

    return yield* toJpegBlob(out);
  });

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

    return yield* toJpegBlob(out);
  });

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

const peekObject = (
  objects: PDFPageProxy["objs"],
  name: string,
): Effect.Effect<unknown | undefined> =>
  Effect.map(
    Effect.option(
      Effect.try({
        try: () => objects.get(name),
        catch: () => null,
      }),
    ),
    (option) => (option._tag === "Some" ? option.value : undefined),
  );

const awaitObject = (
  primary: PDFPageProxy["objs"],
  secondary: PDFPageProxy["objs"],
  name: string,
): Effect.Effect<unknown | undefined> =>
  Effect.timeoutOption(
    Effect.callback<unknown>((resume) => {
      const finish = (data: unknown) => resume(Effect.succeed(data));
      primary.get(name, finish);
      secondary.get(name, finish);
    }),
    IMAGE_LOOKUP_TIMEOUT,
  ).pipe(Effect.map((option) => (option._tag === "Some" ? option.value : undefined)));

const lookupImage = (
  pageProxy: PDFPageProxy,
  name: string,
): Effect.Effect<unknown | undefined> =>
  Effect.gen(function* () {
    const primary = name.startsWith("g_") ? pageProxy.commonObjs : pageProxy.objs;
    const secondary = name.startsWith("g_") ? pageProxy.objs : pageProxy.commonObjs;

    const first = yield* peekObject(primary, name);
    if (first !== undefined) return first;
    const second = yield* peekObject(secondary, name);
    if (second !== undefined) return second;

    return yield* awaitObject(primary, secondary, name);
  });

const paintSource = (
  pageProxy: PDFPageProxy,
  paint: ImagePaint,
): Effect.Effect<unknown | undefined> =>
  Effect.gen(function* () {
    if (paint.inline !== undefined) return paint.inline;
    if (paint.name === undefined) return undefined;
    return yield* lookupImage(pageProxy, paint.name);
  });

const rasterizeCrop = (
  pageProxy: PDFPageProxy,
  page: number,
  undecoded: ReadonlyArray<ImagePaint>,
): Effect.Effect<PageImage[], PdfFailure> =>
  Effect.gen(function* () {
    const started = performance.now();
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
    if (context === null) return [];

    yield* Effect.tryPromise({
      try: () => pageProxy.render({ canvas, canvasContext: context, viewport }).promise,
      catch: pdfFailure,
    });
    const crops = yield* Effect.forEach(
      undecoded,
      (paint) => Effect.map(cropImage(canvas, viewport, paint), (blob) => ({ paint, blob })),
      { concurrency: CROP_CONCURRENCY },
    );
    canvas.width = 0;
    canvas.height = 0;
    yield* log("figures.fallback", `p${page}:${undecoded.length} cropped`, performance.now() - started);

    const cropped: PageImage[] = [];
    for (const crop of crops) {
      if (crop.blob !== null) cropped.push({ ...crop.paint, blob: crop.blob });
    }
    return cropped;
  });

const cleanupPage = (pageProxy: PDFPageProxy): Effect.Effect<void> =>
  Effect.sync(() => {
    pageProxy.cleanup();
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
          yield* log("figures.warnings", `p${page}: ${captured.warnings.join(" | ")}`);
        }
        yield* log(
          "figures.decode",
          `p${page}:${paints.length}${largestImageDims(paints)}`,
          performance.now() - decodeStarted,
        );
        if (paints.length === 0) {
          yield* cleanupPage(pageProxy);
          return [];
        }

        const encoded = yield* Stream.fromIterable(paints).pipe(
          Stream.mapEffect(
            (paint) =>
              Effect.gen(function* () {
                const source = yield* paintSource(pageProxy, paint);
                if (source === undefined) return undefined;
                return yield* encodeImage(source);
              }).pipe(Effect.map((blob) => ({ paint, blob }))),
            { concurrency: PAINT_CONCURRENCY },
          ),
          Stream.runCollect,
        );

        const images: PageImage[] = [];
        const undecoded: ImagePaint[] = [];
        for (const item of encoded) {
          if (item.blob === undefined || item.blob === null) {
            undecoded.push(item.paint);
            continue;
          }
          images.push({ ...item.paint, blob: item.blob });
        }
        yield* log("figures.pixels", `p${page}:${images.length} encoded`);

        if (undecoded.length > 0) {
          const cropped = yield* rasterizeCrop(pageProxy, page, undecoded);
          images.push(...cropped);
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
