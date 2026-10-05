import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import type { PageSize } from "@/domain/book";
import { forkApp, stopFiber } from "@/lib/hooks";
import { renderPdfPage } from "@/use-cases/render-page";
import type { PdfHandle } from "@/services/pdf-client";

const RENDER_SCALE = 1;
const VISIBLE_MARGIN = "600px 0px";

interface Props {
  handle: PdfHandle;
  size: PageSize;
  root: RefObject<HTMLDivElement | null>;
}

export function PdfPage({ handle, size, root }: Props): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (element === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry === undefined) return;
        setVisible(entry.isIntersecting);
      },
      { root: root.current, rootMargin: VISIBLE_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    const fiber = forkApp(
      renderPdfPage(handle, size.page, canvas, RENDER_SCALE).pipe(
        Effect.catchTag("PdfFailure", () => Effect.sync(() => setFailed(true))),
      ),
    );
    return () => stopFiber(fiber);
  }, [handle, size.page, visible]);

  return (
    <div
      ref={wrapperRef}
      data-page={size.page}
      className="w-full overflow-hidden rounded-box bg-white shadow"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {failed && <p className="p-4 text-xs opacity-60">Page {size.page} could not be rendered.</p>}
      {!failed && <canvas ref={canvasRef} className="block h-full w-full" />}
    </div>
  );
}
