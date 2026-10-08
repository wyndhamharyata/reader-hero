import { Effect } from "effect";
import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import type { PageSize } from "@/domain/book";
import { forkApp, stopFiber } from "@/lib/hooks";
import { renderPdfPage } from "@/use-cases/render-page";
import type { RenderedDocument } from "@/services/page-renderer";

// Capped at 1.5x: a sharper page costs memory on a phone and reads the same.
const RENDER_SCALE = Math.min(1.5, globalThis.devicePixelRatio || 1);

interface Props {
  doc: RenderedDocument;
  size: PageSize;
}

// Memoised so a batch of page sizes re-renders only the pages it touches.
export const PdfPage = memo(function PdfPage({ doc, size }: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const fiber = forkApp(
      renderPdfPage(doc, size.page, canvas, RENDER_SCALE).pipe(
        // An opening book waits for this mark on its first page.
        Effect.tap(() =>
          Effect.sync(() => {
            canvas.dataset.painted = "";
          }),
        ),
        Effect.catchTag("PdfFailure", () => Effect.sync(() => setFailed(true))),
      ),
    );
    return () => {
      stopFiber(fiber);
      // A page that leaves the list gives back its bitmap now: iOS caps the memory of all canvases.
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
    };
  }, [doc, size.page]);

  return (
    <div
      data-page={size.page}
      className="w-full overflow-hidden rounded-box bg-white shadow"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {failed && <p className="p-4 text-xs opacity-60">Page {size.page} could not be rendered.</p>}
      {/* Sized in the markup and by its own ratio, never by a percent height: in WebKit a percent
          height inside a flex item makes every layout of the list walk all 600 items, and a later
          canvas size change triggers such a layout. An empty canvas holds no memory. */}
      {!failed && (
        <canvas
          ref={canvasRef}
          width={Math.floor(size.width * RENDER_SCALE)}
          height={Math.floor(size.height * RENDER_SCALE)}
          className="block h-auto w-full"
        />
      )}
    </div>
  );
});
