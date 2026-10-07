import { Effect } from "effect";
import { PdfFailure } from "@/domain/errors";
import { PageRenderer, type RenderedDocument } from "@/services/page-renderer";

// Paints one page: the worker renders a bitmap and the canvas adopts it without a copy.
export function renderPdfPage(
  doc: RenderedDocument,
  page: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Effect.Effect<void, PdfFailure, PageRenderer> {
  return Effect.gen(function* () {
    const renderer = yield* PageRenderer;
    const bitmap = yield* renderer.render(doc, page, scale);
    // The canvas was sized ahead; a size change here would relayout every page, so only a mismatch sets it.
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    // The mark lets tests and the benchmark see when a page is on screen.
    canvas.dataset.painted = "1";
    const adopter = canvas.getContext("bitmaprenderer");
    if (adopter !== null) {
      adopter.transferFromImageBitmap(bitmap);
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      return yield* new PdfFailure({ reason: "unknown", message: "Canvas has no 2d context" });
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
  });
}
