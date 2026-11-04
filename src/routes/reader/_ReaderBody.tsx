import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Effect } from "effect";
import type { Annotation } from "@/domain/annotation";
import type { BookMeta, ParsedBook, ReaderMode, ReaderSettings } from "@/domain/book";
import { forkApp } from "@/lib/hooks";
import {
  mergeAnchor,
  removeAnnotation,
  saveAnnotation,
  saveNote,
  type Anchor,
} from "@/use-cases/annotations";
import type { Chapter } from "@/use-cases/ai-context";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type FindTarget, type JumpRequest } from "./_ReaderView";

interface Props {
  meta: BookMeta;
  parsed: ParsedBook;
  // The book's chapters, so the reader mounts only the ones near the place being read.
  chunks: ReadonlyArray<Chapter>;
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
  annotations: ReadonlyArray<Annotation>;
  focusAnnotation: { readonly id: string; readonly nonce: number } | null;
}

export function ReaderBody({
  meta,
  parsed,
  chunks,
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
  annotations,
  focusAnnotation,
}: Props): ReactElement {
  const addHighlight = useCallback(
    (anchor: Anchor): Annotation => {
      const { annotation, replaced } = mergeAnchor(meta.id, parsed, annotations, anchor);

      forkApp(
        saveAnnotation(annotation, replaced).pipe(
          Effect.catchTag("StorageFailure", () => Effect.void),
        ),
      );

      return annotation;
    },
    [meta.id, parsed, annotations],
  );
  const writeNote = useCallback((annotation: Annotation, note: string): void => {
    forkApp(saveNote(annotation, note).pipe(Effect.catchTag("StorageFailure", () => Effect.void)));
  }, []);
  const remove = useCallback((annotation: Annotation): void => {
    forkApp(
      removeAnnotation(annotation).pipe(Effect.catchTag("StorageFailure", () => Effect.void)),
    );
  }, []);

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
          chunks={chunks}
          settings={settings}
          initialBlock={initialBlock}
          jump={jump}
          onPosition={onPosition}
          onToggleChrome={onToggleChrome}
          onPageTurn={onPageTurn}
          find={find}
          annotations={annotations}
          onHighlight={addHighlight}
          onSaveNote={writeNote}
          onRemoveAnnotation={remove}
          focusAnnotation={focusAnnotation}
          hasCustomCover={meta.customCover === true}
        />
      )}

      {showOriginal && (
        <OriginalView
          key={meta.id}
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
