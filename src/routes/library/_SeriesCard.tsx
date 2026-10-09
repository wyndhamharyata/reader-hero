import type { ReactElement } from "react";
import { ChevronDownIcon, EllipsisVerticalIcon } from "@/components/icons";
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
  const front = series.inProgress ?? series.books[0];
  const backs = series.books.filter((card) => card.book.id !== front?.book.id).slice(-2);
  const author = series.inProgress?.book.author ?? series.books[0]?.book.author;

  return (
    <li
      className="relative isolate list-none"
      data-layout-id={`series:${series.id}`}
      data-series-root={series.id}
    >
      <TrayPart flags={tray} />
      <div className="card relative z-10 w-full bg-base-200">
        <div className="card-body flex-row gap-3 p-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Fold" : "Expand"} ${series.name}`}
            data-series-toggle={series.id}
            onClick={onToggle}
          >
            <div className="relative h-24 w-16 shrink-0">
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
                  <BookCover bookId={front.book.id} />
                </div>
              )}
              <span className="absolute right-0 bottom-0 z-30 badge gap-1 badge-neutral">
                {series.count}
                <ChevronDownIcon
                  className={`size-4 motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-lg font-semibold">{series.name}</span>
                <span className={series.badge.className}>{series.badge.label}</span>
              </div>
              {author !== undefined && (
                <p className="truncate text-base opacity-70 md:text-sm">{author}</p>
              )}
              <p className="text-base opacity-60 md:text-sm">
                {series.count} {series.count === 1 ? "book" : "books"} · {series.finishedCount}{" "}
                finished
              </p>
              {series.inProgress !== null && (
                <p className="mt-auto truncate text-base opacity-60 md:text-sm">
                  {series.inProgress.series?.place ?? 1} of {series.count} ·{" "}
                  {series.inProgress.book.title} · {formatPercent(series.inProgress.percent)}
                </p>
              )}
            </div>
          </button>
          <button
            type="button"
            className="btn btn-square self-end btn-ghost md:btn-sm"
            aria-label="Series actions"
            title="Series actions"
            onClick={onActions}
          >
            <EllipsisVerticalIcon className="size-6 md:size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
