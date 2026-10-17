import { Effect } from "effect";
import { PdfFailure } from "@/domain/errors";
import { searchForm } from "@/lib/find-text";
import {
  PageRenderer,
  type PageTextContent,
  type RenderedDocument,
} from "@/services/page-renderer";

export interface DrawnTextLayer {
  readonly update: (scale: number) => void;
  readonly highlight: (query: string) => void;
  readonly remove: () => void;
}

const SEARCH_HIGHLIGHT = "reader-hero-search";

// Paints ranges without touching text nodes; Safari 17.2+ and Chrome 105+.
const highlights = (): HighlightRegistry | null =>
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
    ? CSS.highlights
    : null;

const searchMap = (layer: HTMLElement) => {
  let text = "";
  const from: Array<{ node: Text; offset: number }> = [];
  let last: { node: Text; offset: number } | null = null;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    // A line end is a <br>; it reads as a space, at the end of the text before it.
    if (node instanceof HTMLBRElement) {
      if (last !== null && !text.endsWith(" ")) {
        text += " ";
        from.push(last);
      }
      continue;
    }
    if (!(node instanceof Text)) continue;
    const value = node.data;
    for (let offset = 0; offset < value.length; offset += 1) {
      const folded = searchForm(value.charAt(offset));
      if (folded === " " && text.endsWith(" ")) continue;
      for (const char of folded) {
        text += char;
        from.push({ node, offset });
      }
      last = { node, offset: offset + 1 };
    }
  }
  return { text, from };
};

// Every page on screen has a layer, and the one highlight holds the matches of them all.
const marked = new Map<HTMLElement, Range[]>();
const paintMarks = (): void => {
  const registry = highlights();
  if (registry === null) return;
  const ranges = [...marked.values()].flat();
  if (ranges.length === 0) registry.delete(SEARCH_HIGHLIGHT);
  else registry.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
};

const markMatches = (layer: HTMLElement, query: string): void => {
  if (highlights() === null) return;
  marked.delete(layer);
  const wanted = searchForm(query).trim();
  if (wanted === "") {
    paintMarks();
    return;
  }
  const { text, from } = searchMap(layer);
  const ranges: Range[] = [];
  for (let at = text.indexOf(wanted); at !== -1; at = text.indexOf(wanted, at + wanted.length)) {
    const start = from[at];
    const end = from[at + wanted.length - 1];
    if (start === undefined || end === undefined) continue;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.length));
    ranges.push(range);
  }
  if (ranges.length > 0) marked.set(layer, ranges);
  paintMarks();
};

// pdf.js measures each run on the main thread; this many stays short on a slow phone.
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

// One slice per event-loop turn, so scrolls and taps run between slices.
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

// Built off the page and added in one step, so the list lays out once.
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

    // As in pdf.js's viewer: while dragging, this covers the gaps so the selection does not jump.
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
      highlight: (query) => markMatches(div, query),
      remove: () => {
        listening.abort();
        if (marked.delete(div)) paintMarks();
        div.remove();
      },
    };
  });
}
