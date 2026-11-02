import type { CSSProperties, ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import { CheckIcon } from "@/components/icons";
import type { ParseState } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";
import { useLongPress } from "@/lib/use-long-press";

const stateLines: Partial<Record<ParseState, string>> = {
  pending: "Waiting",
  parsing: "Building reader",
  failed: "Failed",
};

export function isBuilding(card: LibraryCard): boolean {
  return card.book.parseState === "pending" || card.book.parseState === "parsing";
}

function captionOf(card: LibraryCard, place: number | undefined): string {
  const state = stateLines[card.book.parseState];

  if (state !== undefined) return state;
  if (place !== undefined) return card.status === "reading" ? formatPercent(card.percent) : "";

  return card.book.author ?? "";
}

// A tap opens the book. A hold, a right-click or the menu key opens its sheet.
export function BookTile({
  card,
  place,
  fill,
  motion,
  onOpen,
  onActions,
}: {
  readonly card: LibraryCard;
  // The volume's number, inside a series tray.
  readonly place?: number;
  // How far the import has read this book, while it builds.
  readonly fill: number;
  // "drop" for a book that just arrived, "deal" with its delay as the shelf first shows.
  readonly motion: { readonly name: "drop" | "deal"; readonly delayMs: number } | null;
  readonly onOpen: (cover: Element | null) => void;
  readonly onActions: () => void;
}): ReactElement {
  const press = useLongPress(onActions);
  const { book, status } = card;
  const bookClass = book.format === "epub" ? "book glossy" : "book";
  const caption = captionOf(card, place);
  const motionStyle: CSSProperties | undefined =
    motion === null ? undefined : { animationDelay: `${motion.delayMs}ms` };

  return (
    <li data-book-id={book.id} className={motion?.name} style={motionStyle}>
      <button
        type="button"
        className="book-link w-full select-none [-webkit-touch-callout:none]"
        onClick={(event) => onOpen(event.currentTarget.querySelector(".cover"))}
        {...press}
      >
        <span className={bookClass}>
          {isBuilding(card) ? (
            <span className="cover blank">
              <span className="fill" style={{ height: `${Math.round(fill * 100)}%` }} />
            </span>
          ) : (
            <BookCover book={book} />
          )}
          {status === "reading" && <span className="ribbon" />}
          {status === "finished" && (
            <span className="stamp" aria-label="Finished">
              <CheckIcon className="icon" />
            </span>
          )}
        </span>
        <span className="mt-2.5 flex text-[13.5px] leading-tight font-bold">
          {place !== undefined && <span className="shrink-0">{place}.&nbsp;</span>}
          {card.isClippedAtStart ? (
            // A right-to-left box puts the ellipsis at the start. The <bdi> keeps "Vol. 7" in reading order.
            <span className="min-w-0 truncate [direction:rtl]">
              <bdi dir="ltr">{book.title}</bdi>
            </span>
          ) : (
            <span className="line-clamp-2 min-w-0">{book.title}</span>
          )}
        </span>
        <span
          className={`block truncate text-[12.5px] ${book.parseState === "failed" ? "text-(--red)" : "text-(--ink-soft)"}`}
        >
          {caption}
        </span>
      </button>
    </li>
  );
}
