import type { ReactElement } from "react";
import { EllipsisVerticalIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";
import { formatPercent, formatSize } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { BookTitle } from "./_BookTitle";
import { TrayPart, type TrayFlags } from "./_TrayPart";

export function BookCard({
  card,
  onActions,
  seriesMember,
  tray,
}: {
  card: LibraryCard;
  onActions: () => void;
  seriesMember: boolean;
  tray: TrayFlags | null;
}): ReactElement {
  const { book, badge } = card;
  const href = `/book/${book.id}`;
  // An EPUB has no pages, so its count is an estimate.
  const pages = book.format === "epub" ? `~${book.pageCount}` : `${book.pageCount}`;

  return (
    <li
      className="relative isolate list-none"
      data-layout-id={`book:${book.id}`}
      data-series-member={seriesMember ? card.seriesId : undefined}
    >
      <TrayPart flags={tray} />
      <div className="card relative z-10 w-full bg-base-200">
        <div className="card-body flex-row gap-3 p-3">
          <SlideLink to={href} direction="in" className="w-16 shrink-0">
            <BookCover bookId={book.id} />
          </SlideLink>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-3">
              <SlideLink to={href} direction="in" className="min-w-0 flex-1">
                <BookTitle
                  title={book.title}
                  clipStart={card.clipStart}
                  size="text-lg"
                  fit="truncate"
                />
                {!seriesMember && book.author !== undefined && (
                  <p className="truncate text-base opacity-70 md:text-sm">{book.author}</p>
                )}
                {card.series !== undefined && (
                  <p className="truncate text-base opacity-60 md:text-sm">
                    {seriesMember
                      ? `${card.series.place} of ${card.series.count}`
                      : `${card.series.name} · ${card.series.place} of ${card.series.count}`}
                  </p>
                )}
              </SlideLink>
              <span className={badge.className}>{badge.label}</span>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs opacity-60">
                {pages} pages · {formatSize(book.fileSize)} · {formatPercent(card.percent)}
                {book.figuresPending && " · Rendering figures"}
              </p>
              <button
                type="button"
                className="btn btn-square btn-ghost md:btn-sm"
                aria-label="Book actions"
                title="Book actions"
                onClick={onActions}
              >
                <EllipsisVerticalIcon className="size-6 md:size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
