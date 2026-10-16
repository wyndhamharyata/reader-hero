import { Effect } from "effect";
import { PdfFailure } from "@/domain/errors";
import {
  PageRenderer,
  type PageTextContent,
  type RenderedDocument,
} from "@/services/page-renderer";

export interface DrawnTextLayer {
  // Measures the text again for a new page width.
  readonly update: (scale: number) => void;
  readonly remove: () => void;
}

// pdf.js measures each run of text with the canvas on the main thread; a slice this size stays short on a slow phone.
const ITEMS_PER_SLICE = 150;

const pdfFailure = (cause: unknown): PdfFailure =>
  new PdfFailure({ reason: "unknown", message: String(cause) });

// The text layer reads only these from a viewport, so the worker's plain numbers stand in for one.
const viewportOf = (text: PageTextContent, scale: number) => ({
  scale,
  rotation: text.rotation,
  rawDims: {
    pageWidth: text.pageWidth,
    pageHeight: text.pageHeight,
    pageX: text.pageX,
    pageY: text.pageY,
  },
});

// One slice per turn of the event loop, so a scroll or a tap runs between slices instead of after them all.
const sliced = (content: PageTextContent["content"]): ReadableStream => {
  let at = 0;
  return new ReadableStream(
    {
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (at >= content.items.length) {
          controller.close();
          return;
        }
        controller.enqueue({ ...content, items: content.items.slice(at, at + ITEMS_PER_SLICE) });
        at += ITEMS_PER_SLICE;
      },
    },
    { highWaterMark: 0 },
  );
};

// Builds the page's selectable text out of the page, then adds it in one step, so the list lays out once.
export function drawTextLayer(
  doc: RenderedDocument,
  page: number,
  host: HTMLElement,
  scale: number,
): Effect.Effect<DrawnTextLayer, PdfFailure, PageRenderer> {
  return Effect.gen(function* () {
    const renderer = yield* PageRenderer;
    const text = yield* renderer.text(doc, page);
    const { TextLayer } = yield* Effect.tryPromise({
      try: () => import("pdfjs-dist"),
      catch: pdfFailure,
    });

    const div = document.createElement("div");
    div.className = "textLayer";
    // The page's own box before rotation; the rotation rule turns it to fit the drawn page.
    div.style.width = `calc(var(--total-scale-factor) * ${text.pageWidth}px)`;
    div.style.height = `calc(var(--total-scale-factor) * ${text.pageHeight}px)`;
    const layer = new TextLayer({
      textContentSource: sliced(text.content),
      container: div,
      // The typings ask for a PageViewport; the layer reads only the fields above.
      viewport: viewportOf(text, scale) as never,
    });
    yield* Effect.callback<void, PdfFailure>((resume) => {
      layer.render().then(
        () => resume(Effect.void),
        (cause: unknown) => resume(Effect.fail(pdfFailure(cause))),
      );
      return Effect.sync(() => layer.cancel());
    });

    // As in pdf.js's viewer: while a drag selects, this covers the empty space, so the selection does not jump to the page's end.
    const end = document.createElement("div");
    end.className = "endOfContent";
    div.append(end);
    const listening = new AbortController();
    div.addEventListener("pointerdown", () => div.classList.add("selecting"), {
      signal: listening.signal,
    });
    document.addEventListener("pointerup", () => div.classList.remove("selecting"), {
      signal: listening.signal,
    });
    host.append(div);

    return {
      update: (next) => layer.update({ viewport: viewportOf(text, next) as never }),
      remove: () => {
        listening.abort();
        div.remove();
      },
    };
  });
}
