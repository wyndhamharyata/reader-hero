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
  visible: boolean;
}

// Memoised so a batch of page sizes or a visibility change re-renders only the pages it touches.
export const PdfPage = memo(function PdfPage({ doc, size, visible }: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    if (!visible) {
      // Drops the bitmap and keeps the size, so the page frees its memory without a relayout.
      if (paintedRef.current) canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
      paintedRef.current = false;
      return;
    }

    paintedRef.current = true;
    const fiber = forkApp(
      renderPdfPage(doc, size.page, canvas, RENDER_SCALE).pipe(
        Effect.catchTag("PdfFailure", () => Effect.sync(() => setFailed(true))),
      ),
    );
    return () => stopFiber(fiber);
  }, [doc, size.page, visible]);

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
