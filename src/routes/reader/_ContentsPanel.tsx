import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { Block, TocEntry } from "@/domain/book";
import { findInBlocks, maxMatches, snippetOf, type BlockMatch } from "@/lib/find-text";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

export type ContentsTab = "chapters" | "search";

function entryAt(toc: ReadonlyArray<TocEntry>, blockIndex: number): number {
  return toc.findLastIndex((entry) => entry.blockIndex <= blockIndex);
}

// Chapters and the book's search, in one panel. A result closes it and marks the match on the page.
export function ContentsPanel({
  toc,
  blocks,
  position,
  lines,
  canSearch,
  isOriginal,
  initialTab,
  onSelect,
  onLine,
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
  readonly initialTab: ContentsTab;
  readonly onSelect: (blockIndex: number) => void;
  readonly onLine: (blockIndex: number) => void;
  readonly onFind: (query: string, matches: ReadonlyArray<BlockMatch>, at: number) => void;
  readonly onPageSearch: (query: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [tab, setTab] = useState<ContentsTab>(canSearch ? initialTab : "chapters");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const matches = useMemo(
    () => (isOriginal ? [] : findInBlocks(blocks, searched)),
    [blocks, searched, isOriginal],
  );
  const current = entryAt(toc, position);

  useEffect(() => {
    if (tab === "chapters") currentRef.current?.scrollIntoView({ block: "center" });
  }, [tab]);

  const search = (): void => {
    const words = query.trim();

    if (words === "") return;
    if (isOriginal) {
      dismiss(() => onPageSearch(words));
      return;
    }

    setSearched(words);
  };

  const tabs = canSearch ? (
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
        aria-pressed={tab === "search"}
        onClick={() => setTab("search")}
      >
        Search
      </button>
    </div>
  ) : undefined;

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
      {tab === "search" ? (
        <div key="search">
          <form
            role="search"
            className="field mb-2"
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
              // The tab opens for a search, so the field takes the keyboard at once.
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" className="key small" disabled={query.trim() === ""}>
              Search
            </button>
          </form>
          {searched !== "" && (
            <p className="mx-0.5 mt-1.5 mb-1 text-[13.5px] text-(--ink-soft)">
              {matches.length === 0
                ? "No matches"
                : `${matches.length}${matches.length === maxMatches ? "+" : ""} ${matches.length === 1 ? "result" : "results"}`}
            </p>
          )}
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
                      <mark className="rounded-sm bg-[oklch(88%_0.12_95)] px-0.5 text-(--ink) in-data-[theme=rhdark]:bg-[oklch(48%_0.1_95)]">
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
