import { Effect } from "effect";
import type { PageSize } from "@/domain/book";
import { PdfFailure } from "@/domain/errors";
import { findPages } from "@/lib/find-text";
import { PageRenderer, type PageLink, type RenderedDocument } from "@/services/page-renderer";

// Paints one page, with the worker rendering a bitmap that the canvas adopts without a copy.
export function renderPdfPage(
  rendered: RenderedDocument,
  page: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Effect.Effect<void, PdfFailure, PageRenderer> {
  return Effect.gen(function* () {
    const renderer = yield* PageRenderer;
    const bitmap = yield* renderer.render(rendered, page, scale);
    // The canvas was sized ahead. A size change here would relayout every page, so only a mismatch sets it.
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

// Read after the page draws, so a page's links never hold up its pixels.
export function readPageLinks(
  rendered: RenderedDocument,
  page: number,
): Effect.Effect<ReadonlyArray<PageLink>, PdfFailure, PageRenderer> {
  return Effect.flatMap(PageRenderer, (renderer) => renderer.links(rendered, page));
}

export interface PageArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// Paints one sharp area of a zoomed page over its whole-page bitmap, and places the canvas on that area.
export function renderPageDetail(
  rendered: RenderedDocument,
  size: PageSize,
  canvas: HTMLCanvasElement,
  scale: number,
  area: PageArea,
): Effect.Effect<void, PdfFailure, PageRenderer> {
  return Effect.gen(function* () {
    const renderer = yield* PageRenderer;
    const fullWidth = size.width * scale;
    const fullHeight = size.height * scale;
    const x = Math.floor(area.left * fullWidth);
    const y = Math.floor(area.top * fullHeight);
    const crop = {
      x,
      y,
      // Rounded shares can reach past the page by a pixel. The crop stops at its last whole pixel.
      width: Math.max(
        1,
        Math.min(Math.floor(fullWidth), Math.ceil((area.left + area.width) * fullWidth)) - x,
      ),
      height: Math.max(
        1,
        Math.min(Math.floor(fullHeight), Math.ceil((area.top + area.height) * fullHeight)) - y,
      ),
    };
    const bitmap = yield* renderer.render(rendered, size.page, scale, crop);
    // Placed only now, so the last area stays sharp on screen until this one is ready.
    canvas.style.left = `${(crop.x / fullWidth) * 100}%`;
    canvas.style.top = `${(crop.y / fullHeight) * 100}%`;
    canvas.style.width = `${(crop.width / fullWidth) * 100}%`;
    canvas.style.height = `${(crop.height / fullHeight) * 100}%`;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.hidden = false;
    const adopter = canvas.getContext("bitmaprenderer");
    if (adopter === null) {
      bitmap.close();
      return yield* new PdfFailure({ reason: "unknown", message: "Canvas has no bitmap renderer" });
    }
    adopter.transferFromImageBitmap(bitmap);
  });
}

// The parsed text names candidate pages. The worker keeps those whose own text matches.
export function searchPages(
  rendered: RenderedDocument,
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }>,
  query: string,
): Effect.Effect<ReadonlyArray<number>, never, PageRenderer> {
  return Effect.gen(function* () {
    const candidates = findPages(blocks, query);
    if (candidates.length === 0) return [];
    const renderer = yield* PageRenderer;
    return yield* renderer
      .find(rendered, candidates, query)
      .pipe(Effect.orElseSucceed(() => candidates));
  });
}
