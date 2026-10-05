import { useRef, useState, type ReactElement } from "react";
import type { BookMeta, ParsedBook, ReaderSettings, ReadingProgress } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { runApp } from "@/lib/hooks";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type JumpRequest } from "./_ReaderView";

export type Mode = "reader" | "original";

interface Props {
  meta: BookMeta;
  parsed: ParsedBook;
  progress: ReadingProgress | null;
  mode: Mode;
  chrome: boolean;
  settings: ReaderSettings;
  jump: JumpRequest | null;
  onToggleChrome: () => void;
}

const PROGRESS_SAVE_DELAY_MS = 400;

export function ReaderBody({
  meta,
  parsed,
  progress,
  mode,
  chrome,
  settings,
  jump,
  onToggleChrome,
}: Props): ReactElement {
  const [position, setPosition] = useState(0);
  const saveTimer = useRef<number | null>(null);

  const total = Math.max(1, parsed.blocks.length - 1);
  const scanned = meta.parseState === "scanned";
  const showOriginal = mode === "original" || scanned;
  const initialBlock = progress?.blockIndex ?? 0;
  const currentPage = parsed.blocks[position]?.page ?? 1;
  const percentLabel = formatPercent(position / total);
  const footerClass = `fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] transition-transform ${chrome ? "" : "translate-y-full"}`;

  const onPosition = (blockIndex: number) => {
    setPosition(blockIndex);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void runApp(saveReadingProgress(meta.id, blockIndex, total));
    }, PROGRESS_SAVE_DELAY_MS);
  };

  const onOriginalPage = (page: number) => {
    const index = parsed.blocks.findIndex((block) => block.page >= page);
    if (index >= 0) onPosition(index);
  };

  return (
    <>
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
          <div className="fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-20 px-3">
            <div className="alert alert-warning py-2 text-xs">
              <span>No text layer found. Showing the original pages.</span>
            </div>
          </div>
        )}
      </div>

      <footer className={footerClass}>
        <div className="flex items-center gap-3">
          <span className="w-10 text-xs opacity-70">{percentLabel}</span>
          <progress
            className="progress progress-primary h-1.5 flex-1"
            value={position}
            max={total}
          />
        </div>
      </footer>
    </>
  );
}
