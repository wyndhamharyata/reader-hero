import { Effect } from "effect";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PageSize } from "@/domain/book";
import { runApp } from "@/lib/hooks";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

const RENDER_SCALE = 1;
const VISIBLE_MARGIN = "600px 0px";

interface Props {
  handle: PdfHandle;
  size: PageSize;
  root: RefObject<HTMLDivElement | null>;
}

export function PdfPage({ handle, size, root }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

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

    // Release the backing store for pages far from the viewport; iOS has a low
    // canvas-memory budget and rendering every page at devicePixelRatio would
    // exhaust it.
    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let active = true;
    void runApp(
      Effect.flatMap(PdfClient, (pdf) => pdf.render(handle, size.page, canvas, RENDER_SCALE)),
    ).then(
      () => {
        if (!active) {
          canvas.width = 0;
          canvas.height = 0;
        }
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [handle, size.page, visible]);

  return (
    <div
      ref={wrapperRef}
      data-page={size.page}
      className="w-full overflow-hidden rounded-box bg-white shadow"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
