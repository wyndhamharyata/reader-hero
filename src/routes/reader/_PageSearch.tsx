import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { forkApp, stopFiber, type Job } from "@/lib/hooks";
import type { RenderedDocument } from "@/services/page-renderer";
import { searchPages } from "@/use-cases/render-page";
import { FindBar } from "./_FindBar";

// The original view's find: it goes page by page, as the render worker confirms each page.
export function PageSearch({
  doc,
  blocks,
  initialQuery,
  currentPage,
  onGo,
  onQuery,
  onClose,
}: {
  readonly doc: RenderedDocument;
  readonly blocks: ReadonlyArray<{ readonly text: string; readonly page: number }>;
  readonly initialQuery: string;
  readonly currentPage: number;
  readonly onGo: (page: number) => void;
  readonly onQuery: (query: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const [pages, setPages] = useState<ReadonlyArray<number> | null>(null);
  const [index, setIndex] = useState(0);
  const job = useRef<Job | null>(null);
  const start = useRef({ currentPage, onGo, onQuery });

  // Once, with the words from Contents. The first match at or after the page being read comes first.
  useEffect(() => {
    const { currentPage: from, onGo: go, onQuery: query } = start.current;

    job.current = forkApp(
      searchPages(doc, blocks, initialQuery).pipe(
        Effect.tap((found) =>
          Effect.sync(() => {
            const ahead = found.findIndex((page) => page >= from);
            const first = ahead === -1 ? 0 : ahead;
            const page = found[first];

            setPages(found);
            setIndex(first);
            query(initialQuery);
            if (page !== undefined) go(page);
          }),
        ),
      ),
    );

    return () => {
      if (job.current !== null) stopFiber(job.current);
    };
  }, [doc, blocks, initialQuery]);

  const step = (by: 1 | -1): void => {
    if (pages === null || pages.length === 0) return;

    const next = (index + by + pages.length) % pages.length;
    const page = pages[next];

    setIndex(next);
    if (page !== undefined) onGo(page);
  };

  const count =
    pages === null
      ? "Searching"
      : pages.length === 0
        ? "No matches"
        : `${index + 1} of ${pages.length} ${pages.length === 1 ? "page" : "pages"}`;

  return (
    <FindBar
      query={initialQuery}
      count={count}
      hasMatches={pages !== null && pages.length > 0}
      onStep={step}
      onClose={() => {
        onQuery("");
        onClose();
      }}
    />
  );
}
