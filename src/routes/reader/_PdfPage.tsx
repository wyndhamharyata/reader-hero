import { Effect } from "effect";
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { PageSize } from "@/domain/book";
import { forkApp, stopFiber } from "@/lib/hooks";
import {
  readPageLinks,
  renderPageDetail,
  renderPdfPage,
  type PageArea,
} from "@/use-cases/render-page";
import { drawTextLayer, type DrawnTextLayer } from "@/use-cases/text-layer";
import type { PageLink, RenderedDocument } from "@/services/page-renderer";

interface Props {
  doc: RenderedDocument;
  size: PageSize;
  // CSS pixels per PDF point at the width the page is shown.
  scale: number;
  // Device pixels per PDF point of the whole-page bitmap, which a zoom keeps as it is.
  renderScale: number;
  // Only pages on screen hold their text, so the list never carries many pages of text nodes.
  hasText: boolean;
  query: string;
  // Null while the whole-page bitmap is sharp enough.
  detail: { readonly scale: number; readonly area: PageArea } | null;
  onTextReady: (page: number) => void;
  onJump: (page: number) => void;
}

const box = (link: PageLink): CSSProperties => ({
  left: `${link.left * 100}%`,
  top: `${link.top * 100}%`,
  width: `${link.width * 100}%`,
  height: `${link.height * 100}%`,
});

// Memoised so a batch of page sizes re-renders only the pages it touches.
export const PdfPage = memo(function PdfPage({
  doc,
  size,
  scale,
  renderScale,
  hasText,
  query,
  detail,
  onTextReady,
  onJump,
}: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<DrawnTextLayer | null>(null);
  const scaleRef = useRef(scale);
  const queryRef = useRef(query);
  const [failed, setFailed] = useState(false);
  const [links, setLinks] = useState<ReadonlyArray<PageLink>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) return;

    const fiber = forkApp(
      renderPdfPage(doc, size.page, canvas, renderScale).pipe(
        Effect.catchTag("PdfFailure", () => Effect.sync(() => setFailed(true))),
      ),
    );

    return () => {
      stopFiber(fiber);
      // A page that drops out of the list gives back its bitmap when it unmounts. iOS caps the memory of all canvases.
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
    };
  }, [doc, size.page, renderScale]);

  useEffect(() => {
    if (failed) {
      setLinks([]);
      return;
    }

    const fiber = forkApp(
      readPageLinks(doc, size.page).pipe(
        Effect.catchTag("PdfFailure", () => Effect.succeed([])),
        Effect.tap((found) => Effect.sync(() => setLinks(found))),
      ),
    );

    return () => stopFiber(fiber);
  }, [doc, size.page, failed]);

  const detailScale = detail?.scale ?? 0;
  const { left = 0, top = 0, width = 0, height = 0 } = detail?.area ?? {};

  useEffect(() => {
    const canvas = detailRef.current;

    if (canvas === null) return;
    if (detailScale === 0) {
      // Only a canvas that held an area has a context. Making one would cost every mount.
      if (!canvas.hidden) canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
      canvas.hidden = true;
      return;
    }

    const area = { left, top, width, height };
    const fiber = forkApp(
      renderPageDetail(doc, size, canvas, detailScale, area).pipe(
        Effect.catchTag("PdfFailure", () => Effect.void),
      ),
    );

    return () => stopFiber(fiber);
  }, [doc, size, detailScale, left, top, width, height]);

  useEffect(() => {
    const canvas = detailRef.current;
    return () => {
      if (canvas !== null && !canvas.hidden) {
        canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
      }
    };
  }, []);

  useEffect(() => {
    const host = textRef.current;

    if (!hasText || host === null) return;

    const drawnAt = scaleRef.current;
    const fiber = forkApp(
      drawTextLayer(doc, size.page, host, drawnAt).pipe(
        Effect.tap((drawn) =>
          Effect.sync(() => {
            // A zoom during the build found no layer to update.
            if (scaleRef.current !== drawnAt) drawn.update(scaleRef.current);
            textLayer.current = drawn;
            drawn.highlight(queryRef.current);
            onTextReady(size.page);
          }),
        ),
        Effect.catchTag("PdfFailure", () => Effect.void),
      ),
    );

    return () => {
      stopFiber(fiber);
      textLayer.current?.remove();
      textLayer.current = null;
    };
  }, [doc, size.page, hasText, onTextReady]);

  useEffect(() => {
    queryRef.current = query;
    textLayer.current?.highlight(query);
  }, [query]);

  useEffect(() => {
    scaleRef.current = scale;
    textLayer.current?.update(scale);
  }, [scale]);

  return (
    <div
      data-page={size.page}
      className="relative w-full overflow-hidden rounded-box bg-white shadow [contain:layout_paint]"
      style={
        {
          aspectRatio: `${size.width} / ${size.height}`,
          "--total-scale-factor": scale,
        } as CSSProperties
      }
    >
      {failed && <p className="p-4 text-xs opacity-60">Page {size.page} could not be rendered.</p>}
      {/* No percent height, because with one each WebKit list layout walks all 600 items. */}
      {!failed && (
        <canvas
          ref={canvasRef}
          width={Math.floor(size.width * renderScale)}
          height={Math.floor(size.height * renderScale)}
          className="block h-auto w-full"
        />
      )}
      <canvas ref={detailRef} hidden className="absolute" />
      <div ref={textRef} className="absolute inset-0" />
      {/* A click on a link is not a tap on the page, so it never toggles the bars. */}
      {links.map((link, index) =>
        "url" in link.target ? (
          <a
            key={index}
            href={link.target.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.target.url}
            className="absolute z-10 rounded-sm"
            style={box(link)}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <button
            key={index}
            type="button"
            aria-label={`Go to page ${link.target.page}`}
            className="absolute z-10 rounded-sm"
            style={box(link)}
            onClick={(event) => {
              event.stopPropagation();
              if ("page" in link.target) onJump(link.target.page);
            }}
          />
        ),
      )}
    </div>
  );
});
