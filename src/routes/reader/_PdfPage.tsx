import { Effect } from "effect";
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { PageSize } from "@/domain/book";
import { forkApp, stopFiber } from "@/lib/hooks";
import { readPageLinks, renderPdfPage } from "@/use-cases/render-page";
import { drawTextLayer, type DrawnTextLayer } from "@/use-cases/text-layer";
import type { PageLink, RenderedDocument } from "@/services/page-renderer";

// Capped at 1.5x: a sharper page costs memory on a phone and reads the same.
const RENDER_SCALE = Math.min(1.5, globalThis.devicePixelRatio || 1);

interface Props {
  doc: RenderedDocument;
  size: PageSize;
  // CSS pixels per PDF point at the width the page is shown.
  scale: number;
  // Only the page being read holds its text, so the list never carries many pages of text nodes.
  text: boolean;
  // The search to mark on this page's text; empty for none.
  query: string;
  onTextReady: (page: number) => void;
  onJump: (page: number) => void;
}

const box = (link: PageLink) => ({
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
  text,
  query,
  onTextReady,
  onJump,
}: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const textLayer = useRef<DrawnTextLayer | null>(null);
  const scaleRef = useRef(scale);
  const queryRef = useRef(query);
  const [failed, setFailed] = useState(false);
  const [links, setLinks] = useState<ReadonlyArray<PageLink>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const fiber = forkApp(
      renderPdfPage(doc, size.page, canvas, RENDER_SCALE).pipe(
        Effect.catchTag("PdfFailure", () => Effect.sync(() => setFailed(true))),
        Effect.andThen(
          readPageLinks(doc, size.page).pipe(
            Effect.catchTag("PdfFailure", () => Effect.succeed([])),
            Effect.tap((found) => Effect.sync(() => setLinks(found))),
          ),
        ),
      ),
    );
    return () => {
      stopFiber(fiber);
      // A page that leaves the list gives back its bitmap now: iOS caps the memory of all canvases.
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
    };
  }, [doc, size.page]);

  useEffect(() => {
    const host = textRef.current;
    if (!text || host === null) return;
    const fiber = forkApp(
      drawTextLayer(doc, size.page, host, scaleRef.current).pipe(
        Effect.tap((drawn) =>
          Effect.sync(() => {
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
  }, [doc, size.page, text, onTextReady]);

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
          width={Math.floor(size.width * RENDER_SCALE)}
          height={Math.floor(size.height * RENDER_SCALE)}
          className="block h-auto w-full"
        />
      )}
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
