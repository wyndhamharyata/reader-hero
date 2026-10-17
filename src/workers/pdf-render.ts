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
import { pageSearchText, searchForm } from "@/lib/find-text";
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
type Opened = { task: PDFDocumentLoadingTask; document: PDFDocumentProxy; drawn: Set<number> };
const documents = new Map<number, Opened>();
const tasks = new Map<number, RenderTask>();
// A cancel can land before its render has a task, so the render checks this after each wait.
const rendering = new Set<number>();
const cancelled = new Set<number>();
// An open closed before it finished is destroyed once it does.
const opening = new Set<number>();
const closedEarly = new Set<number>();

// pdf.js's mobile cap for one canvas, whatever scale is asked; under WebKit's limit.
const MAX_CANVAS_PIXELS = 5_242_880;

// pdf.js's own viewer keeps its last 10 pages: fewer re-parses a page on the way back, more holds memory.
const KEEP_PAGES = 10;

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

type OpenMessage = { type: "open"; id: number; file: Blob };
type RenderMessage = {
  type: "render";
  requestId: number;
  id: number;
  page: number;
  scale: number;
  crop?: { x: number; y: number; width: number; height: number };
};

// A close that came mid-open destroys the document, and nothing answers.
const openDocument = async (message: OpenMessage): Promise<void> => {
  const origin = self.location.origin;
  // Read here, so the main thread never copies the whole file.
  const bytes = await message.file.arrayBuffer();
  await pdfWorker().promise;
  if (closedEarly.has(message.id)) return;
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
  if (closedEarly.has(message.id)) {
    void task.destroy();
    return;
  }
  documents.set(message.id, { task, document, drawn: new Set() });
  const first = (await document.getPage(1)).getViewport({ scale: 1 });
  postMessage({
    type: "opened",
    id: message.id,
    pageCount: document.numPages,
    width: first.width,
    height: first.height,
  });
};

// Stops at each wait once cancelled, so a page flung past never delays one on screen.
const render = async (opened: Opened, message: RenderMessage): Promise<void> => {
  const page = await opened.document.getPage(message.page);
  if (cancelled.has(message.requestId)) return;
  let viewport = page.getViewport({ scale: message.scale });
  const { crop } = message;
  if (crop === undefined && viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
    const fit = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    viewport = page.getViewport({ scale: message.scale * fit });
  }
  const canvas =
    crop === undefined
      ? new OffscreenCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
      : new OffscreenCanvas(crop.width, crop.height);
  // pdf.js types the canvas as a DOM element; it only needs a 2d context.
  const task = page.render({
    canvas: canvas as never,
    viewport,
    // A crop draws only its part of the page, moved to the canvas's corner, as pdf.js's detail view does.
    ...(crop === undefined ? {} : { transform: [1, 0, 0, 1, -crop.x, -crop.y] }),
  });
  tasks.set(message.requestId, task);
  let bitmap: ImageBitmap;
  try {
    await task.promise;
    bitmap = canvas.transferToImageBitmap();
  } finally {
    tasks.delete(message.requestId);
    canvas.width = 0;
    canvas.height = 0;
  }
  if (cancelled.has(message.requestId)) {
    bitmap.close();
    return;
  }
  postMessage({ type: "rendered", requestId: message.requestId, bitmap }, [bitmap]);
  await keepDrawn(opened, message.page);
};

onmessage = async (event: MessageEvent) => {
  const message = event.data as
    | { type: "warm" }
    | OpenMessage
    | { type: "size"; requestId: number; id: number; page: number }
    | RenderMessage
    | { type: "links"; requestId: number; id: number; page: number }
    | { type: "text"; requestId: number; id: number; page: number }
    | { type: "find"; requestId: number; id: number; pages: number[]; query: string }
    | { type: "cancel"; requestId: number }
    | { type: "close"; id: number };
  try {
    // Starts the worker early, so the first open does not wait for its 1.3 MB script.
    if (message.type === "warm") {
      void pdfWorker().promise.catch(() => undefined);
      return;
    }
    if (message.type === "open") {
      opening.add(message.id);
      try {
        await openDocument(message);
      } finally {
        opening.delete(message.id);
        closedEarly.delete(message.id);
      }
      return;
    }
    if (message.type === "cancel") {
      if (!rendering.has(message.requestId)) return;
      cancelled.add(message.requestId);
      tasks.get(message.requestId)?.cancel();
      return;
    }
    if (message.type === "close") {
      if (opening.has(message.id)) closedEarly.add(message.id);
      void documents.get(message.id)?.task.destroy();
      documents.delete(message.id);
      return;
    }
    const opened = documents.get(message.id);
    if (opened === undefined) throw new Error("Document is closed");
    if (message.type === "find") {
      const wanted = searchForm(message.query).trim();
      const found: number[] = [];
      for (const number of message.pages) {
        const content = await (await opened.document.getPage(number)).getTextContent();
        const runs = content.items.filter((item) => "str" in item);
        if (pageSearchText(runs).includes(wanted)) found.push(number);
      }
      postMessage({ type: "found", requestId: message.requestId, pages: found });
      return;
    }
    if (message.type === "render") {
      rendering.add(message.requestId);
      try {
        await render(opened, message);
      } finally {
        rendering.delete(message.requestId);
        cancelled.delete(message.requestId);
      }
      return;
    }
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
  } catch (cause) {
    const key =
      "requestId" in message ? message.requestId : message.type === "open" ? message.id : null;
    if (key !== null) {
      postMessage({ type: "error", requestId: key, message: String(cause) });
    }
  }
};
