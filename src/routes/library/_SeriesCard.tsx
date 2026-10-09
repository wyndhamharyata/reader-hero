import type { ReactElement } from "react";
import { ChevronDownIcon, PencilIcon } from "@/components/icons";
import { formatPercent } from "@/lib/format";
import type { Shelf } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { TrayPart, type TrayFlags } from "./_TrayPart";

export function SeriesCard({
  series,
  expanded,
  onToggle,
  onActions,
  tray,
}: {
  series: Extract<Shelf["items"][number], { kind: "series" }>;
  expanded: boolean;
  onToggle: () => void;
  onActions: () => void;
  tray: TrayFlags | null;
}): ReactElement {
  // The reader's choice first, their own image or a book; else the book in progress, or the first.
  const front =
    series.cover === "image"
      ? `series:${series.id}`
      : (
          series.books.find((card) => card.book.id === series.cover) ??
          series.inProgress ??
          series.books[0]
        )?.book.id;
  const backs = series.books.filter((card) => card.book.id !== front).slice(-2);
  const author = series.inProgress?.book.author ?? series.books[0]?.book.author;

  return (
    <li className="relative isolate list-none" data-series-root={series.id}>
      <TrayPart flags={tray} />
      <div className="card relative z-10 h-full w-full bg-base-200">
        {/* A layer over the card, so the pencil can sit in the text column as on a book card. */}
        <div className="card-body relative flex-row gap-3 p-3">
          <button
            type="button"
            className="absolute inset-0 rounded-box"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Fold" : "Expand"} ${series.name}`}
            data-series-toggle={series.id}
            onClick={onToggle}
          />
          <div className="pointer-events-none relative h-24 w-16 shrink-0">
            {/* Dim while open, so the stack does not compete with the books after it. */}
            <div
              className={`absolute inset-0 motion-safe:transition-[filter] ${expanded ? "brightness-50" : ""}`}
            >
              {backs[1] !== undefined && (
                <div className="absolute top-0 left-2 w-14 brightness-75">
                  <BookCover bookId={backs[1].book.id} />
                </div>
              )}
              {backs[0] !== undefined && (
                <div className="absolute top-1.5 left-1 w-14 brightness-90">
                  <BookCover bookId={backs[0].book.id} />
                </div>
              )}
              {front !== undefined && (
                <div className="absolute top-3 left-0 w-14">
                  <BookCover bookId={front} />
                </div>
              )}
            </div>
            <span className="absolute right-0 bottom-0 z-30 badge gap-1 badge-neutral">
              {series.count}
              <ChevronDownIcon
                className={`size-4 motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </span>
          </div>
          <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-lg font-semibold">{series.name}</p>
            {author !== undefined && (
              <p className="truncate text-base opacity-70 md:text-sm">{author}</p>
            )}
            <p className="text-base opacity-60 md:text-sm">
              {series.count} {series.count === 1 ? "book" : "books"} · {series.finishedCount}{" "}
              finished
            </p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-base opacity-60 md:text-sm">
                {series.inProgress !== null &&
                  `${series.inProgress.series?.place ?? 1} of ${series.count} · ${series.inProgress.book.title} · ${formatPercent(series.inProgress.percent)}`}
              </p>
              <button
                type="button"
                className="btn pointer-events-auto relative btn-square btn-ghost md:btn-sm"
                aria-label="Edit series"
                title="Edit series"
                onClick={onActions}
              >
                <PencilIcon className="size-6 md:size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
