import type { ReactElement } from "react";
import { Link } from "react-router";
import { EllipsisVerticalIcon } from "@/components/icons";
import { formatPercent } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { BookTitle } from "./_BookTitle";

interface Props {
  card: LibraryCard;
  onRemove: (id: string) => void;
  onReparse: (id: string) => void;
}

export function BookTile({ card, onRemove, onReparse }: Props): ReactElement {
  const { book, badge } = card;
  const href = `/book/${book.id}`;

  return (
    <li className="flex min-w-0 flex-col gap-2">
      <Link to={href} className="relative block">
        <BookCover bookId={book.id} />
        <span className={`${badge.className} absolute top-2 left-2`}>{badge.label}</span>
      </Link>
      <div className="flex items-end gap-1">
        <Link to={href} className="min-w-0 flex-1">
          <BookTitle
            title={book.title}
            clipStart={card.clipStart}
            size="text-sm"
            fit="line-clamp-2"
          />
          {book.author !== undefined && (
            <p className="truncate text-xs opacity-70">{book.author}</p>
          )}
          <p className="text-xs opacity-60">{formatPercent(card.percent)}</p>
        </Link>
        {/* Upward on phones, clear of the bottom bar; a div trigger because Safari skips focus on a tapped button. */}
        <div className="dropdown dropdown-end dropdown-top md:dropdown-bottom">
          <div
            tabIndex={0}
            role="button"
            className="btn btn-square btn-ghost btn-xs"
            aria-label="Book actions"
          >
            <EllipsisVerticalIcon className="size-5 md:size-4" />
          </div>
          <ul
            tabIndex={0}
            className="menu dropdown-content z-10 w-32 rounded-box bg-base-100 p-1 shadow"
          >
            <li>
              <button type="button" onClick={() => onReparse(book.id)}>
                Rebuild
              </button>
            </li>
            <li>
              <button type="button" className="text-error" onClick={() => onRemove(book.id)}>
                Delete
              </button>
            </li>
          </ul>
        </div>
      </div>
    </li>
  );
}
