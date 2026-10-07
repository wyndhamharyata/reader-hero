// Holds a PDF and paints its pages to OffscreenCanvas, so the original view never paints on the main thread.
import {
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";

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
const documents = new Map<number, { task: PDFDocumentLoadingTask; document: PDFDocumentProxy }>();
const tasks = new Map<number, RenderTask>();

// One pdf.js worker for every document. A "warm" message starts it early, so the first open
// does not wait for its 1.3 MB script. pdf.js reads `window.location` before it makes its own
// worker, which throws here, so the port is made here and parsing stays off this thread.
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
    | { type: "cancel"; requestId: number }
    | { type: "close"; id: number };
  try {
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
        // With a font set in this worker (Safari 16.4 and later) text paints through the font
        // engine; without one every glyph is drawn as a path, which is slower.
        ...(fonts === undefined
          ? { disableFontFace: true }
          : { disableFontFace: false, ownerDocument: { fonts } as never }),
        CanvasFactory: OffscreenCanvasFactory,
        FilterFactory: NoFilterFactory,
        worker: pdfWorker(),
      });
      const document = await task.promise;
      documents.set(message.id, { task, document });
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
  } catch (cause) {
    const key =
      "requestId" in message ? message.requestId : message.type === "open" ? message.id : null;
    if (key !== null) {
      postMessage({ type: "error", requestId: key, message: String(cause) });
    }
  }
};
