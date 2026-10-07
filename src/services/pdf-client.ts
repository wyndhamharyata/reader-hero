import { Context, Effect, Layer, Schema, Stream } from "effect";
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
  StoredImage,
} from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { toPageText } from "@/lib/pdf/page-text";
import { collectImageBoxes, imagePayloadFields, type ImagePaint } from "@/lib/pdf/image-boxes";

type PdfLib = typeof import("pdfjs-dist");

let pdfLib: Promise<PdfLib> | null = null;

const pdfFailure = (cause: unknown): PdfFailure => {
  const name = cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);
  if (name === "PasswordException") return new PdfFailure({ reason: "password", message });
  if (name === "InvalidPDFException") return new PdfFailure({ reason: "corrupt", message });
  return new PdfFailure({ reason: "unknown", message });
};

// Loaded on first use, so a cold start of the library does not parse pdf.js; a failed load retries.
const loadLib = (): Effect.Effect<PdfLib, PdfFailure> =>
  Effect.tryPromise({
    try: () =>
      (pdfLib ??= import("pdfjs-dist")
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = "/worker/pdf.worker.shimmed.min.mjs";
          return lib;
        })
        .catch((cause: unknown) => {
          pdfLib = null;
          throw cause;
        })),
    catch: pdfFailure,
  });

const IMAGE_RENDER_SCALE = 1.5;
const IMAGE_LOOKUP_TIMEOUT = "15 seconds";
const PAINT_CONCURRENCY = 2;
const CROP_CONCURRENCY = 2;

export interface PdfHandle {
  readonly proxy: PDFDocumentProxy;
  readonly task: PDFDocumentLoadingTask;
  readonly numPages: number;
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

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

// One worker draws and encodes figures, so the thread that scrolls does none of that work.
let encoder: Worker | null = null;
let nextEncode = 0;
const encodes = new Map<number, (blob: Blob | null) => void>();

const encodeInWorker = (
  request: {
    width: number;
    height: number;
    maxDim: number;
    source: ImageBitmap | { bytes: Uint8ClampedArray; alpha: boolean };
  },
  transfer: Transferable[],
): Effect.Effect<Blob | null> =>
  Effect.callback((resume) => {
    if (encoder === null) {
      encoder = new Worker(new URL("../workers/encode-image.ts", import.meta.url), {
        type: "module",
      });
      encoder.onmessage = (event: MessageEvent) => {
        const reply = event.data as { id: number; blob: Blob | null };
        encodes.get(reply.id)?.(reply.blob);
        encodes.delete(reply.id);
      };
      encoder.onerror = () => {
        for (const settle of encodes.values()) settle(null);
        encodes.clear();
      };
    }
    const id = nextEncode;
    nextEncode += 1;
    encodes.set(id, (blob) => resume(Effect.succeed(blob)));
    encoder.postMessage({ id, ...request }, transfer);
    return Effect.sync(() => encodes.delete(id));
  });

const encodeImage = (
  lib: PdfLib,
  source: unknown,
  maxDim: number,
): Effect.Effect<Blob | null, PdfFailure> =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(PdfImagePayload)(source);
    if (decoded._tag === "None") return null;
    const image = decoded.value;
    const width = image.width;
    const height = image.height;
    if (width <= 0 || height <= 0) return null;

    // pdf.js keeps the original for later paints, so a copy goes to the worker; a transfer would detach it.
    if (image.bitmap instanceof ImageBitmap) {
      const copy = yield* Effect.tryPromise({
        try: () => createImageBitmap(image.bitmap as ImageBitmap),
        catch: pdfFailure,
      });
      return yield* encodeInWorker({ width, height, maxDim, source: copy }, [copy]);
    }
    const data = image.data;
    if (!(data instanceof Uint8ClampedArray || data instanceof Uint8Array)) return null;
    const alpha = image.kind === lib.ImageKind.RGBA_32BPP;
    if (!alpha && image.kind !== lib.ImageKind.RGB_24BPP) return null;
    const bytes = Uint8ClampedArray.from(data);
    return yield* encodeInWorker({ width, height, maxDim, source: { bytes, alpha } }, [
      bytes.buffer,
    ]);
  });

const cropImage = (
  source: HTMLCanvasElement,
  viewport: PageViewport,
  box: ImagePlacement,
  maxDim: number,
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
    const scale = Math.min(1, maxDim / Math.max(width, height));
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(height * scale));
    const context = out.getContext("2d");
    if (context === null) return null;
    context.drawImage(source, left, top, width, height, 0, 0, out.width, out.height);

    return yield* toJpegBlob(out);
  });

const readBoxes = (
  lib: PdfLib,
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
      lib.OPS,
      lib.Util,
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

const lookupImage = (pageProxy: PDFPageProxy, name: string): Effect.Effect<unknown | undefined> =>
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
  undecoded: ReadonlyArray<ImagePaint>,
  maxDim: number,
): Effect.Effect<PageImage[], PdfFailure> =>
  Effect.gen(function* () {
    const base = pageProxy.getViewport({ scale: 1 });
    // The page renders a little larger than one figure, so a crop of part of the page stays sharp.
    const renderScale = Math.min(
      IMAGE_RENDER_SCALE,
      (maxDim * 1.5) / Math.max(base.width, base.height, 1),
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
      (paint) =>
        Effect.map(cropImage(canvas, viewport, paint, maxDim), (blob) => ({ paint, blob })),
      { concurrency: CROP_CONCURRENCY },
    );
    canvas.width = 0;
    canvas.height = 0;

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
    readImages(
      handle: PdfHandle,
      page: number,
    ): Effect.Effect<ReadonlyArray<PageImage>, PdfFailure>;
    thumbnail(
      handle: PdfHandle,
      page: number,
      width: number,
    ): Effect.Effect<Omit<StoredImage, "id"> | null, PdfFailure>;
    pageSize(handle: PdfHandle, page: number): Effect.Effect<PageSize, PdfFailure>;
    readOutline(handle: PdfHandle): Effect.Effect<ReadonlyArray<OutlineItem>, PdfFailure>;
    release(handle: PdfHandle): Effect.Effect<void>;
    pageCount(handle: PdfHandle): number;
  }
>()("reader-hero/PdfClient") {
  static readonly layer = Layer.succeed(
    PdfClient,
    PdfClient.of({
      load: Effect.fn("PdfClient.load")(function* (data: ArrayBuffer) {
        const lib = yield* loadLib();
        const origin = (globalThis as { location?: { origin: string } }).location?.origin ?? "";
        // Enable pdf.js's WASM decoders (JPEG 2000, JBIG2, ICC/qcms). Without a
        // served wasmUrl they silently fall back to slow pure-JS decoding.
        const task = lib.getDocument({
          data,
          useWorkerFetch: true,
          wasmUrl: `${origin}/wasm/`,
          iccUrl: `${origin}/icc/`,
          // Safari exposes ImageDecoder in both contexts; make the preference
          // explicit so the JPEG fast path cannot be lost to default merging.
          isImageDecoderSupported: true,
        });
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
        return toPageText(page, content, pageProxy.getViewport({ scale: 1 }));
      }),

      readImages: Effect.fn("PdfClient.readImages")(function* (handle: PdfHandle, page: number) {
        const lib = yield* loadLib();
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });

        const paints = yield* readBoxes(lib, pageProxy, page);
        if (paints.length === 0) {
          yield* cleanupPage(pageProxy);
          return [];
        }

        // A figure never shows wider than the screen, so it stores no more pixels than that;
        // two device pixels per CSS pixel is sharp enough, and fewer pixels mean a faster job.
        const maxDim = Math.min(1400, Math.round(screen.width * Math.min(2, devicePixelRatio)));

        const encoded = yield* Stream.fromIterable(paints).pipe(
          Stream.mapEffect(
            (paint) =>
              Effect.gen(function* () {
                const source = yield* paintSource(pageProxy, paint);
                if (source === undefined) return undefined;
                return yield* encodeImage(lib, source, maxDim);
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

        if (undecoded.length > 0) {
          const cropped = yield* rasterizeCrop(pageProxy, undecoded, maxDim);
          images.push(...cropped);
        }

        yield* cleanupPage(pageProxy);
        return images;
      }),

      thumbnail: Effect.fn("PdfClient.thumbnail")(function* (
        handle: PdfHandle,
        page: number,
        width: number,
      ) {
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });
        const viewport = pageProxy.getViewport({
          scale: width / pageProxy.getViewport({ scale: 1 }).width,
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (context === null) {
          return yield* new PdfFailure({ reason: "unknown", message: "Canvas has no 2d context" });
        }
        yield* Effect.tryPromise({
          try: (signal) => {
            const task = pageProxy.render({ canvas, canvasContext: context, viewport });
            signal.addEventListener("abort", () => task.cancel());
            return task.promise;
          },
          catch: pdfFailure,
        });
        const blob = yield* toJpegBlob(canvas);
        const size = { width: canvas.width, height: canvas.height };
        canvas.width = 0;
        canvas.height = 0;
        yield* cleanupPage(pageProxy);
        return blob === null ? null : { blob, ...size };
      }),
      pageSize: Effect.fn("PdfClient.pageSize")(function* (handle: PdfHandle, page: number) {
        const pageProxy = yield* Effect.tryPromise({
          try: () => handle.proxy.getPage(page),
          catch: pdfFailure,
        });
        const viewport = pageProxy.getViewport({ scale: 1 });
        return { page, width: viewport.width, height: viewport.height };
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
