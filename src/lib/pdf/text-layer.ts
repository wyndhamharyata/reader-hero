import { Effect } from "effect";
import { PdfFailure } from "@/domain/errors";
import type { PageTextContent } from "@/services/page-renderer";

// pdf.js measures each run on the main thread. This many stays short on a slow phone.
const ITEMS_PER_SLICE = 150;

export const pdfFailure = (cause: unknown): PdfFailure =>
  new PdfFailure({ reason: "unknown", message: String(cause) });

// The text layer reads only these from a viewport, so the worker's plain numbers stand in for one.
export const viewportOf = (text: PageTextContent, scale: number) => ({
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
export const sliced = (content: PageTextContent["content"]): ReadableStream => {
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

export const loadTextLayer = (): Effect.Effect<
  (typeof import("pdfjs-dist"))["TextLayer"],
  PdfFailure
> =>
  Effect.tryPromise({
    try: () => import("pdfjs-dist"),
    catch: pdfFailure,
  }).pipe(Effect.map((library) => library.TextLayer));
