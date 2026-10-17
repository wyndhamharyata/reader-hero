import type { Virtualizer } from "@tanstack/react-virtual";
import type { ReactElement, RefObject } from "react";
import type { PageSize } from "@/domain/book";
import { pageRenderScale } from "@/lib/render-scale";
import type { RenderedDocument } from "@/services/page-renderer";
import type { PageArea } from "@/use-cases/render-page";
import { PdfPage } from "./_PdfPage";

export function PdfPageList({
  virtualizer,
  listRef,
  sizes,
  doc,
  pageWidth,
  width,
  ratio,
  textPages,
  query,
  details,
  onTextReady,
  onJump,
}: {
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly sizes: ReadonlyArray<PageSize>;
  readonly doc: RenderedDocument;
  readonly pageWidth: number;
  readonly width: number;
  readonly ratio: number;
  readonly textPages: ReadonlySet<number>;
  readonly query: string;
  readonly details: ReadonlyMap<number, { readonly scale: number; readonly area: PageArea }>;
  readonly onTextReady: (page: number) => void;
  readonly onJump: (page: number) => void;
}): ReactElement {
  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {/* Not before the column is measured, so no page draws at a scale it then draws again. */}
      {width > 0 &&
        virtualizer.getVirtualItems().map((item) => {
          const size = sizes[item.index];
          return (
            size !== undefined && (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <PdfPage
                  doc={doc}
                  size={size}
                  scale={pageWidth / size.width}
                  renderScale={pageRenderScale(size, width, ratio)}
                  hasText={textPages.has(size.page)}
                  query={textPages.has(size.page) ? query : ""}
                  detail={details.get(size.page) ?? null}
                  onTextReady={onTextReady}
                  onJump={onJump}
                />
              </div>
            )
          );
        })}
    </div>
  );
}
