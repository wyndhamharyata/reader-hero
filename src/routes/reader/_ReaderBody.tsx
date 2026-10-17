import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { BookMeta, ParsedBook, ReaderMode, ReaderSettings } from "@/domain/book";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type JumpRequest } from "./_ReaderView";

interface Props {
  meta: BookMeta;
  parsed: ParsedBook;
  position: number;
  onPosition: (blockIndex: number) => void;
  mode: ReaderMode;
  chrome: boolean;
  settings: ReaderSettings;
  jump: JumpRequest | null;
  searching: boolean;
  onCloseSearch: () => void;
  onToggleChrome: () => void;
}

export function ReaderBody({
  meta,
  parsed,
  position,
  onPosition,
  mode,
  chrome,
  settings,
  jump,
  searching,
  onCloseSearch,
  onToggleChrome,
}: Props): ReactElement {
  const scanned = meta.parseState === "scanned";
  const showOriginal = mode === "original" || scanned;
  // Taken at mount, as the live place would render every block again on each block reached.
  const [initialBlock, setInitialBlock] = useState(position);

  useEffect(() => {
    if (showOriginal) setInitialBlock(position);
  }, [showOriginal, position]);

  const currentPage = parsed.blocks[position]?.page ?? 1;

  // Stable, or every page change rebuilds the original view's observer over every page.
  const onOriginalPage = useCallback(
    (page: number) => {
      const index = parsed.blocks.findIndex((block) => block.page >= page);

      if (index >= 0) onPosition(index);
    },
    [parsed, onPosition],
  );

  const pageJump = useMemo(
    () =>
      jump === null ? null : { page: parsed.blocks[jump.index]?.page ?? 1, nonce: jump.nonce },
    [jump, parsed],
  );

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
          customCover={meta.customCover === true}
        />
      )}

      {showOriginal && (
        <OriginalView
          bookId={meta.id}
          pageCount={meta.pageCount}
          initialPage={currentPage}
          showChrome={chrome}
          jump={pageJump}
          blocks={scanned ? null : parsed.blocks}
          searching={searching}
          onCloseSearch={onCloseSearch}
          onPageChange={onOriginalPage}
          onToggleChrome={onToggleChrome}
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
