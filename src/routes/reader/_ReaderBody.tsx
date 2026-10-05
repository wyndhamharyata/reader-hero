import type { ReactElement } from "react";
import type { BookMeta, ParsedBook, ReaderSettings, ReadingProgress } from "@/domain/book";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type JumpRequest } from "./_ReaderView";

export type Mode = "reader" | "original";

interface Props {
  meta: BookMeta;
  parsed: ParsedBook;
  progress: ReadingProgress | null;
  position: number;
  onPosition: (blockIndex: number) => void;
  mode: Mode;
  chrome: boolean;
  settings: ReaderSettings;
  jump: JumpRequest | null;
  onToggleChrome: () => void;
}

export function ReaderBody({
  meta,
  parsed,
  progress,
  position,
  onPosition,
  mode,
  chrome,
  settings,
  jump,
  onToggleChrome,
}: Props): ReactElement {
  const scanned = meta.parseState === "scanned";
  const showOriginal = mode === "original" || scanned;
  const initialBlock = progress?.blockIndex ?? 0;
  const currentPage = parsed.blocks[position]?.page ?? 1;

  const onOriginalPage = (page: number) => {
    const index = parsed.blocks.findIndex((block) => block.page >= page);
    if (index >= 0) onPosition(index);
  };

  return (
    <div className="h-full">
      {!showOriginal && (
        <ReaderView
          bookId={meta.id}
          parsed={parsed}
          settings={settings}
          initialBlock={initialBlock}
          jump={jump}
          onPosition={onPosition}
          onToggleChrome={onToggleChrome}
        />
      )}

      {showOriginal && (
        <OriginalView
          bookId={meta.id}
          pageCount={meta.pageCount}
          initialPage={currentPage}
          showChrome={chrome}
          onPageChange={onOriginalPage}
        />
      )}

      {scanned && mode === "reader" && (
        <div className="absolute inset-x-0 top-[calc(0.75rem+var(--safe-top))] z-20 px-3 md:top-[calc(5.5rem+var(--safe-top))]">
          <div className="alert py-2 text-xs alert-warning">
            <span>No text layer found. Showing the original pages.</span>
          </div>
        </div>
      )}
    </div>
  );
}
