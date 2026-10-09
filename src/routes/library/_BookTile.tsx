import type { ReactElement } from "react";
import { PencilIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";
import { formatPercent } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { BookTitle } from "./_BookTitle";
import { TrayPart, type TrayFlags } from "./_TrayPart";

export function BookTile({
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

  return (
    <li
      className="relative isolate flex min-w-0 flex-col gap-2"
      data-series-member={seriesMember ? card.seriesId : undefined}
    >
      <TrayPart flags={tray} />
      {/* The tile fills its row, so every pencil in a row sits on the same line. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2">
        <SlideLink to={href} direction="in" className="relative block">
          <BookCover bookId={book.id} />
          <span className={`${badge.className} absolute top-2 left-2`}>{badge.label}</span>
        </SlideLink>
        <div className="flex flex-1 items-end gap-1">
          <SlideLink to={href} direction="in" className="min-w-0 flex-1 self-start">
            <BookTitle
              title={book.title}
              clipStart={card.clipStart}
              size="text-sm"
              fit="line-clamp-2"
            />
            {book.author !== undefined && (
              <p className="truncate text-xs opacity-70">{book.author}</p>
            )}
            {card.series !== undefined && !seriesMember && (
              <p className="truncate text-xs opacity-60">
                {card.series.name} · {card.series.place} of {card.series.count}
              </p>
            )}
            <p className="text-xs opacity-60">
              {seriesMember && card.series !== undefined
                ? `${card.series.place} of ${card.series.count} · ${formatPercent(card.percent)}`
                : formatPercent(card.percent)}
            </p>
          </SlideLink>
          <button
            type="button"
            className="btn btn-square btn-ghost btn-xs"
            aria-label="Edit book"
            title="Edit book"
            onClick={onActions}
          >
            <PencilIcon className="size-5 md:size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
