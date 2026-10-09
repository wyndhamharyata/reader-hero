import type { ReactElement } from "react";
import { ChevronDownIcon, PencilIcon } from "@/components/icons";
import type { Shelf } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { BookTitle } from "./_BookTitle";
import { TrayPart, type TrayFlags } from "./_TrayPart";

export function SeriesTile({
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
    <li className="relative isolate flex min-w-0 flex-col gap-2" data-series-root={series.id}>
      <TrayPart flags={tray} />
      {/* The tile fills its row, so every pencil in a row sits on the same line. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          className="relative block w-full text-left"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Fold" : "Expand"} ${series.name}`}
          data-series-toggle={series.id}
          onClick={onToggle}
        >
          <div className="relative aspect-[2/3]">
            {/* Dim while open, so the stack does not compete with the books after it. */}
            <div
              className={`absolute inset-0 motion-safe:transition-[filter] ${expanded ? "brightness-50" : ""}`}
            >
              {backs[1] !== undefined && (
                <div className="absolute top-0 right-0 w-[calc(100%-10px)] brightness-75">
                  <BookCover bookId={backs[1].book.id} />
                </div>
              )}
              {backs[0] !== undefined && (
                <div className="absolute top-1.5 right-1.5 w-[calc(100%-10px)] brightness-90">
                  <BookCover bookId={backs[0].book.id} />
                </div>
              )}
              {front !== undefined && (
                <div className="absolute top-2.5 right-2.5 w-[calc(100%-10px)]">
                  <BookCover bookId={front} />
                </div>
              )}
            </div>
            <span className="absolute right-2 bottom-2 z-20 badge gap-1 badge-neutral">
              {series.count}
              <ChevronDownIcon
                className={`size-4 motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </span>
          </div>
        </button>
        <div className="flex flex-1 items-end gap-1">
          <button
            type="button"
            className="min-w-0 flex-1 self-start text-left"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Fold" : "Expand"} ${series.name}`}
            data-series-toggle={series.id}
            onClick={onToggle}
          >
            <BookTitle title={series.name} clipStart={false} size="text-sm" fit="line-clamp-2" />
            {author !== undefined && <p className="truncate text-xs opacity-70">{author}</p>}
            <p className="text-xs opacity-60">
              {series.count} {series.count === 1 ? "book" : "books"} · {series.finishedCount}{" "}
              finished
            </p>
          </button>
          <button
            type="button"
            className="btn btn-square btn-ghost btn-xs"
            aria-label="Edit series"
            title="Edit series"
            onClick={onActions}
          >
            <PencilIcon className="size-5 md:size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
