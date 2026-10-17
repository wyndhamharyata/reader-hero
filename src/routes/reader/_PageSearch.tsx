import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from "@/components/icons";
import { forkApp, stopFiber, type Job } from "@/lib/hooks";
import type { RenderedDocument } from "@/services/page-renderer";
import { searchPages } from "@/use-cases/render-page";

interface Props {
  doc: RenderedDocument;
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }>;
  currentPage: number;
  onGo: (page: number) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
}

// Searches on Enter, not on each key, so a slow phone goes through the book's text once per search.
export function PageSearch({
  doc,
  blocks,
  currentPage,
  onGo,
  onQuery,
  onClose,
}: Props): ReactElement {
  const [value, setValue] = useState("");
  const [pages, setPages] = useState<ReadonlyArray<number> | null>(null);
  const [index, setIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const job = useRef<Job | null>(null);
  useEffect(
    () => () => {
      if (job.current !== null) stopFiber(job.current);
    },
    [],
  );

  const search = (): void => {
    if (job.current !== null) stopFiber(job.current);
    setSearching(true);
    job.current = forkApp(
      searchPages(doc, blocks, value).pipe(
        Effect.tap((found) =>
          Effect.sync(() => {
            setSearching(false);
            // The first match at or after the page being read, as a reader's find goes forward from here.
            const ahead = found.findIndex((page) => page >= currentPage);
            const start = ahead === -1 ? 0 : ahead;
            setPages(found);
            setIndex(start);
            onQuery(value);
            const page = found[start];
            if (page !== undefined) onGo(page);
          }),
        ),
      ),
    );
  };

  const step = (by: 1 | -1): void => {
    if (pages === null || pages.length === 0) return;
    const next = (index + by + pages.length) % pages.length;
    setIndex(next);
    const page = pages[next];
    if (page !== undefined) onGo(page);
  };

  const close = (): void => {
    onQuery("");
    onClose();
  };

  const count = searching
    ? "Searching…"
    : pages === null
      ? null
      : pages.length === 0
        ? "No matches"
        : `${index + 1} of ${pages.length} ${pages.length === 1 ? "page" : "pages"}`;

  return (
    <form
      role="search"
      className="absolute inset-x-2 top-2 z-30 flex items-center gap-1 rounded-box bg-base-100 p-1 shadow-lg md:mx-auto md:max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        // Enter again on the same words goes on to the next match, as a browser's find does.
        if (pages === null) search();
        else step(1);
      }}
    >
      {/* 16px text on phones: iOS zooms the page into any focused input smaller than that. */}
      <label className="input min-w-0 flex-1 text-base md:text-sm">
        <MagnifyingGlassIcon className="size-5 opacity-50 md:size-4" />
        <input
          type="search"
          enterKeyHint="search"
          className="grow"
          placeholder="Search pages"
          aria-label="Search pages"
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setPages(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        />
        {count !== null && <span className="shrink-0 text-xs opacity-60">{count}</span>}
      </label>
      <button
        type="button"
        className="btn btn-square btn-ghost md:btn-sm"
        aria-label="Previous match"
        title="Previous match"
        disabled={pages === null || pages.length === 0}
        onClick={() => step(-1)}
      >
        <ChevronDownIcon className="size-6 rotate-180 md:size-4" />
      </button>
      <button
        type="button"
        className="btn btn-square btn-ghost md:btn-sm"
        aria-label="Next match"
        title="Next match"
        disabled={pages === null || pages.length === 0}
        onClick={() => step(1)}
      >
        <ChevronDownIcon className="size-6 md:size-4" />
      </button>
      <button
        type="button"
        className="btn btn-square btn-ghost md:btn-sm"
        aria-label="Close search"
        title="Close search"
        onClick={close}
      >
        <XMarkIcon className="size-6 md:size-4" />
      </button>
    </form>
  );
}
