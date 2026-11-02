import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { BookMeta, ParsedBook, ReaderMode, ReaderSettings } from "@/domain/book";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type FindTarget, type JumpRequest } from "./_ReaderView";

interface Props {
  meta: BookMeta;
  parsed: ParsedBook;
  position: number;
  onPosition: (blockIndex: number) => void;
  mode: ReaderMode;
  showChrome: boolean;
  settings: ReaderSettings;
  jump: JumpRequest | null;
  find: FindTarget | null;
  // The words the original view's page search goes to. Null shows no page search.
  pageQuery: string | null;
  onCloseSearch: () => void;
  onToggleChrome: () => void;
  onPageTurn: () => void;
}

export function ReaderBody({
  meta,
  parsed,
  position,
  onPosition,
  mode,
  showChrome,
  settings,
  jump,
  find,
  pageQuery,
  onCloseSearch,
  onToggleChrome,
  onPageTurn,
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
          onPageTurn={onPageTurn}
          find={find}
          hasCustomCover={meta.customCover === true}
        />
      )}

      {showOriginal && (
        <OriginalView
          bookId={meta.id}
          pageCount={meta.pageCount}
          initialPage={currentPage}
          showChrome={showChrome}
          jump={pageJump}
          blocks={scanned ? null : parsed.blocks}
          pageQuery={pageQuery}
          onCloseSearch={onCloseSearch}
          onPageChange={onOriginalPage}
          onToggleChrome={onToggleChrome}
        />
      )}

      {scanned && mode === "reader" && (
        <p className="notice warn absolute inset-x-3 top-[calc(0.75rem+var(--safe-top))] z-20 md:mx-auto md:max-w-xl">
          No text layer found. Showing the original pages.
        </p>
      )}
    </div>
  );
}
