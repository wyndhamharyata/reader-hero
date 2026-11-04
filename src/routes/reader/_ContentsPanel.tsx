import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { MagnifyingGlassIcon, PencilIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { Annotation } from "@/domain/annotation";
import type { Block, TocEntry } from "@/domain/book";
import { findInBlocks, maxMatches, snippetOf, type BlockMatch } from "@/lib/find-text";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

function entryAt(toc: ReadonlyArray<TocEntry>, blockIndex: number): number {
  return toc.findLastIndex((entry) => entry.blockIndex <= blockIndex);
}

// Chapters, with the book's search pinned above them. A search swaps the list for its results. A result closes the panel and marks the match on the page.
export function ContentsPanel({
  toc,
  blocks,
  position,
  lines,
  canSearch,
  isOriginal,
  annotations,
  initialTab,
  onSelect,
  onLine,
  onEdit,
  onFind,
  onPageSearch,
  onClose,
}: {
  readonly toc: ReadonlyArray<TocEntry>;
  readonly blocks: ReadonlyArray<Block>;
  readonly position: number;
  // One-line summaries by the block index of their entry. Empty with Summaries in Contents off.
  readonly lines: ReadonlyMap<number, string>;
  // A scanned book has no text to search.
  readonly canSearch: boolean;
  // The original pages search page by page, in their own find bar.
  readonly isOriginal: boolean;
  readonly annotations: ReadonlyArray<Annotation>;
  readonly initialTab: "chapters" | "highlights";
  readonly onSelect: (blockIndex: number) => void;
  readonly onEdit: (annotation: Annotation) => void;
  readonly onLine: (blockIndex: number) => void;
  readonly onFind: (query: string, matches: ReadonlyArray<BlockMatch>, at: number) => void;
  readonly onPageSearch: (query: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [tab, setTab] = useState(initialTab);
  const matches = useMemo(
    () => (isOriginal ? [] : findInBlocks(blocks, searched)),
    [blocks, searched, isOriginal],
  );
  const current = entryAt(toc, position);

  const isSearching = searched !== "";

  // The chapters open at the one being read. Results open at their first.
  useEffect(() => {
    if (searched === "") currentRef.current?.scrollIntoView({ block: "center" });
    else sheetRef.current?.querySelector(".panel-body")?.scrollTo(0, 0);
  }, [searched]);

  const search = (): void => {
    const words = query.trim();

    if (words === "") return;
    if (isOriginal) {
      dismiss(() => onPageSearch(words));
      return;
    }

    setSearched(words);
  };

  // Above the list, so it stays put while the list scrolls, and still when it takes the keyboard.
  const searchField = canSearch ? (
    <form
      role="search"
      className="field mx-5 mb-3 w-auto flex-none"
      onSubmit={(event) => {
        event.preventDefault();
        search();
      }}
    >
      <MagnifyingGlassIcon className="icon text-(--ink-soft)" />
      <input
        type="search"
        enterKeyHint="search"
        placeholder="Search this book"
        aria-label="Search this book"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // Cleared, the chapters come back.
          if (event.target.value === "") setSearched("");
        }}
      />
      <button type="submit" className="key small" disabled={query.trim() === ""}>
        Search
      </button>
    </form>
  ) : undefined;

  const groups: Array<{ title: string; items: Array<Annotation> }> = [];

  for (const annotation of annotations) {
    const title = toc[entryAt(toc, annotation.from.block)]?.title ?? "";
    const last = groups.at(-1);

    if (last !== undefined && last.title === title) last.items.push(annotation);
    else groups.push({ title, items: [annotation] });
  }

  const tabs = (
    <>
      {!isSearching && (
        <div className="panel-tabs latch-row flex" role="group" aria-label="Show">
          <button
            type="button"
            className="key"
            aria-pressed={tab === "chapters"}
            onClick={() => setTab("chapters")}
          >
            Chapters
          </button>
          <button
            type="button"
            className="key"
            aria-pressed={tab === "highlights"}
            onClick={() => setTab("highlights")}
          >
            Highlights
          </button>
        </div>
      )}
      {searchField}
    </>
  );

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Contents"
      title="Contents"
      docks
      tabs={tabs}
      onDismiss={() => dismiss()}
    >
      {isSearching ? (
        <div key="search">
          <p className="mx-0.5 mb-1 text-[13.5px] text-(--ink-soft)">
            {matches.length === 0
              ? `No matches for "${searched}"`
              : `${matches.length}${matches.length === maxMatches ? "+" : ""} ${matches.length === 1 ? "result" : "results"}`}
          </p>
          <ul>
            {matches.map((match, at) => {
              const text = blocks[match.index]?.text ?? "";
              const snippet = snippetOf(text, match);
              const where = toc[entryAt(toc, match.index)]?.title;

              return (
                <li key={`${match.index}:${match.start}`} className="border-t border-(--line)">
                  <button
                    type="button"
                    className="block w-full px-1 py-3 text-left"
                    onClick={() => dismiss(() => onFind(searched, matches, at))}
                  >
                    {where !== undefined && (
                      <span className="block text-[13.5px] font-semibold">{where}</span>
                    )}
                    <span className="mt-0.5 block font-serif text-[15px] leading-normal text-(--ink-soft)">
                      {snippet.before}
                      <mark className="rounded-sm bg-[oklch(88%_0.12_95)] px-0.5 text-(--ink) in-data-[theme=rhdark]:bg-[oklch(48%_0.1_95)] in-data-[theme=rhdim]:bg-[oklch(78%_0.12_95)]">
                        {snippet.match}
                      </mark>
                      {snippet.after}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : tab === "highlights" ? (
        <ul key="highlights" className="flex flex-col">
          {annotations.length === 0 && (
            <li className="py-3 text-(--ink-soft)">No highlights yet</li>
          )}
          {groups.map((group) => (
            <li key={group.title} className="first:-mt-3">
              {group.title !== "" && <h3 className="section-title">{group.title}</h3>}
              <ul>
                {group.items.map((annotation) => (
                  <li key={annotation.id} className="border-t border-(--line)">
                    <div className="flex items-start gap-2 py-3">
                      <button
                        type="button"
                        className="block min-w-0 flex-1 text-left"
                        onClick={() => dismiss(() => onSelect(annotation.from.block))}
                      >
                        <span className="line-clamp-3 block border-l-4 border-(--hl) pl-2 font-serif text-[15px] leading-snug">
                          {annotation.quote.join(" ")}
                        </span>
                        {annotation.note !== undefined && (
                          <span className="mt-1 line-clamp-2 block text-[13.5px] text-(--ink-soft)">
                            {annotation.note}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="key small square"
                        aria-label="Edit"
                        onClick={() => dismiss(() => onEdit(annotation))}
                      >
                        <PencilIcon className="icon" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul key="chapters" className="flex flex-col">
          {toc.length === 0 && <li className="py-3 text-(--ink-soft)">No contents in this book</li>}
          {toc.map((entry, index) => {
            const isCurrent = index === current;
            const line = lines.get(entry.blockIndex);
            const itemClass = isCurrent
              ? "-mx-2.5 rounded-xl bg-(--green-wash) px-2.5"
              : "border-t border-(--line) first:border-t-0 [[data-current]+&]:border-transparent";

            return (
              <li
                key={index}
                ref={isCurrent ? currentRef : undefined}
                data-current={isCurrent ? "" : undefined}
                className={itemClass}
                style={{ paddingLeft: entry.depth > 0 ? `${entry.depth}rem` : undefined }}
              >
                <button
                  type="button"
                  className="block w-full py-3 text-left font-semibold"
                  aria-current={isCurrent ? "location" : undefined}
                  onClick={() => dismiss(() => onSelect(entry.blockIndex))}
                >
                  {entry.title}
                </button>
                {line !== undefined && (
                  <button
                    type="button"
                    className="-mt-2 block w-full pb-3 text-left text-[13.5px] text-(--ink-soft)"
                    onClick={() => dismiss(() => onLine(entry.blockIndex))}
                  >
                    <span className="line-clamp-2">{line}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
