// Holds a PDF and paints its pages to OffscreenCanvas, so the original view never paints on the main thread.
import {
  AnnotationType,
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import type { PageLink, PageTextContent } from "@/services/page-renderer";

GlobalWorkerOptions.workerSrc = "/worker/pdf.worker.shimmed.min.mjs";

// pdf.js makes its scratch canvases through this; a worker has no document to make them from.
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (target.canvas !== null) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

// SVG filters need a document, so every filter is "none" here.
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  addSelectionFilter() {
    return "none";
  }
  destroy() {}
}

const fonts = (self as { fonts?: FontFaceSet }).fonts;
const documents = new Map<
  number,
  { task: PDFDocumentLoadingTask; document: PDFDocumentProxy; drawn: Set<number> }
>();
const tasks = new Map<number, RenderTask>();

// pdf.js's own viewer keeps its last 10 pages: fewer re-parses a page on the way back, more holds memory.
const KEEP_PAGES = 10;

// Oldest first, so a page drawn again moves to the end and the first one is the one to free.
const keepDrawn = async (
  opened: { document: PDFDocumentProxy; drawn: Set<number> },
  page: number,
) => {
  opened.drawn.delete(page);
  opened.drawn.add(page);
  if (opened.drawn.size <= KEEP_PAGES) return;
  const [oldest] = opened.drawn;
  if (oldest === undefined) return;
  opened.drawn.delete(oldest);
  (await opened.document.getPage(oldest)).cleanup();
};

// Only schemes a reader expects a tap to open; pdf.js has already checked the URL is absolute.
const OPENABLE = /^(https?|mailto|tel):/i;

// A link inside the document names its page by a reference, by an index, or by a named destination.
const linkPage = async (document: PDFDocumentProxy, dest: unknown): Promise<number | null> => {
  const explicit = typeof dest === "string" ? await document.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const [ref] = explicit as unknown[];
  if (typeof ref === "number" && Number.isInteger(ref)) return ref + 1;
  if (typeof ref !== "object" || ref === null) return null;
  return (await document.getPageIndex(ref as never)) + 1;
};

const readLinks = async (
  document: PDFDocumentProxy,
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
): Promise<PageLink[]> => {
  const viewport = page.getViewport({ scale: 1 });
  const links: PageLink[] = [];
  for (const annotation of await page.getAnnotations({ intent: "display" })) {
    const { annotationType, rect, url, dest } = annotation as {
      annotationType: number;
      rect: number[];
      url?: unknown;
      dest?: unknown;
    };
    if (annotationType !== AnnotationType.LINK) continue;
    let target: PageLink["target"] | null = null;
    if (typeof url === "string" && OPENABLE.test(url)) target = { url };
    else if (dest !== undefined) {
      const linked = await linkPage(document, dest).catch(() => null);
      if (linked !== null) target = { page: linked };
    }
    if (target === null) continue;
    const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(
      rect[0] ?? 0,
      rect[1] ?? 0,
    ) as number[];
    const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(
      rect[2] ?? 0,
      rect[3] ?? 0,
    ) as number[];
    links.push({
      left: Math.min(x1, x2) / viewport.width,
      top: Math.min(y1, y2) / viewport.height,
      width: Math.abs(x2 - x1) / viewport.width,
      height: Math.abs(y2 - y1) / viewport.height,
      target,
    });
  }
  return links;
};

// One pdf.js worker for every document; pdf.js cannot make it here, as it reads `window.location`.
let shared: PDFWorker | null = null;
const pdfWorker = (): PDFWorker => {
  if (shared !== null) return shared;
  try {
    const port = new Worker(GlobalWorkerOptions.workerSrc, { type: "module" });
    // The typings allow only null here; the runtime takes a Worker or a MessagePort.
    shared = new PDFWorker({ port: port as never });
  } catch {
    // No nested workers here: pdf.js parses on this thread instead.
    shared = new PDFWorker();
  }
  return shared;
};

onmessage = async (event: MessageEvent) => {
  const message = event.data as
    | { type: "warm" }
    | { type: "open"; id: number; file: Blob }
    | { type: "size"; requestId: number; id: number; page: number }
    | { type: "render"; requestId: number; id: number; page: number; scale: number }
    | { type: "links"; requestId: number; id: number; page: number }
    | { type: "text"; requestId: number; id: number; page: number }
    | { type: "cancel"; requestId: number }
    | { type: "close"; id: number };
  try {
    // Starts the worker early, so the first open does not wait for its 1.3 MB script.
    if (message.type === "warm") {
      void pdfWorker().promise.catch(() => undefined);
      return;
    }
    if (message.type === "open") {
      const origin = self.location.origin;
      // Read here, so the main thread never copies the whole file.
      const bytes = await message.file.arrayBuffer();
      await pdfWorker().promise;
      const task = getDocument({
        data: bytes,
        useWorkerFetch: true,
        wasmUrl: `${origin}/wasm/`,
        iccUrl: `${origin}/icc/`,
        isImageDecoderSupported: true,
        // Safari 16.4+ paints text through the font engine, faster than glyph paths.
        ...(fonts === undefined
          ? { disableFontFace: true }
          : { disableFontFace: false, ownerDocument: { fonts } as never }),
        CanvasFactory: OffscreenCanvasFactory,
        FilterFactory: NoFilterFactory,
        worker: pdfWorker(),
      });
      const document = await task.promise;
      documents.set(message.id, { task, document, drawn: new Set() });
      const first = (await document.getPage(1)).getViewport({ scale: 1 });
      postMessage({
        type: "opened",
        id: message.id,
        pageCount: document.numPages,
        width: first.width,
        height: first.height,
      });
      return;
    }
    if (message.type === "cancel") {
      tasks.get(message.requestId)?.cancel();
      return;
    }
    if (message.type === "close") {
      void documents.get(message.id)?.task.destroy();
      documents.delete(message.id);
      return;
    }
    const opened = documents.get(message.id);
    if (opened === undefined) throw new Error("Document is closed");
    const page = await opened.document.getPage(message.page);
    if (message.type === "size") {
      const viewport = page.getViewport({ scale: 1 });
      postMessage({
        type: "size",
        requestId: message.requestId,
        page: message.page,
        width: viewport.width,
        height: viewport.height,
      });
      return;
    }
    if (message.type === "links") {
      postMessage({
        type: "links",
        requestId: message.requestId,
        links: await readLinks(opened.document, page),
      });
      return;
    }
    if (message.type === "text") {
      const { pageWidth, pageHeight, pageX, pageY } = page.getViewport({ scale: 1 }).rawDims as {
        pageWidth: number;
        pageHeight: number;
        pageX: number;
        pageY: number;
      };
      const text: PageTextContent = {
        content: await page.getTextContent(),
        rotation: page.rotate,
        pageWidth,
        pageHeight,
        pageX,
        pageY,
      };
      postMessage({ type: "text", requestId: message.requestId, text });
      return;
    }
    const viewport = page.getViewport({ scale: message.scale });
    const canvas = new OffscreenCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    // pdf.js types the canvas as a DOM element; it only needs a 2d context.
    const task = page.render({ canvas: canvas as never, viewport });
    tasks.set(message.requestId, task);
    try {
      await task.promise;
    } finally {
      tasks.delete(message.requestId);
    }
    const bitmap = canvas.transferToImageBitmap();
    postMessage({ type: "rendered", requestId: message.requestId, bitmap }, [bitmap]);
    await keepDrawn(opened, message.page);
  } catch (cause) {
    const key =
      "requestId" in message ? message.requestId : message.type === "open" ? message.id : null;
    if (key !== null) {
      postMessage({ type: "error", requestId: key, message: String(cause) });
    }
  }
};
