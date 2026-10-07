import type { ReactElement } from "react";
import { SlideLink } from "@/components/SlideLink";
import { formatPercent, formatSize } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { BookTitle } from "./_BookTitle";

interface Props {
  card: LibraryCard;
  onRemove: (id: string) => void;
  onReparse: (id: string) => void;
}

export function BookCard({ card, onRemove, onReparse }: Props): ReactElement {
  const { book, badge } = card;
  const href = `/book/${book.id}`;
  // An EPUB has no pages, so its count is an estimate.
  const pages = book.format === "epub" ? `~${book.pageCount}` : `${book.pageCount}`;

  return (
    <li className="card bg-base-200">
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
              {book.author !== undefined && (
                <p className="truncate text-sm opacity-70">{book.author}</p>
              )}
            </SlideLink>
            <span className={badge.className}>{badge.label}</span>
          </div>

          <p className="text-xs opacity-60">
            {pages} pages · {formatSize(book.fileSize)} · {formatPercent(card.percent)}
            {book.figuresPending && " · rendering figures…"}
          </p>

          <div className="mt-auto card-actions justify-end">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onReparse(book.id)}
            >
              Rebuild
            </button>
            <button
              type="button"
              className="btn btn-ghost text-error btn-xs"
              onClick={() => onRemove(book.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
