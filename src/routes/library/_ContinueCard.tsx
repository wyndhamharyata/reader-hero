import type { CSSProperties, ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import { formatPercent } from "@/lib/format";
import type { LibraryCard } from "@/lib/shelf";

// The book being read, up front. Its bar and page edge grow from the old place to the new one after reading.
export function ContinueCard({
  card,
  isGreen,
  onOpen,
}: {
  readonly card: LibraryCard;
  // Only the first card's key is green, so one action leads.
  readonly isGreen: boolean;
  readonly onOpen: (cover: Element | null) => void;
}): ReactElement {
  const percent = formatPercent(card.percent);
  const read = { "--read": card.percent } as CSSProperties;

  return (
    <section className="deal flex min-w-0 flex-1 items-center gap-4.5 rounded-[18px] border border-(--line) bg-(--surface) p-4 md:max-w-[560px] md:p-5">
      <button
        type="button"
        className="book-link w-[84px] shrink-0 md:w-[104px]"
        aria-label={`Open ${card.book.title}`}
        onClick={(event) => onOpen(event.currentTarget.querySelector(".cover"))}
      >
        <span className="book leaning" style={read}>
          <BookCover book={card.book} />
          <span className="fore" />
          <span className="ribbon [animation-delay:-1.2s]" />
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="line-clamp-2 font-serif text-[19px] leading-tight font-bold">
          {card.book.title}
        </h2>
        {card.book.author !== undefined && (
          <p className="truncate text-[13.5px] text-(--ink-soft)">{card.book.author}</p>
        )}
        <div className="meter my-2">
          <span style={{ width: percent }} />
        </div>
        <div>
          <button
            type="button"
            className={isGreen ? "key green small" : "key small"}
            onClick={(event) =>
              onOpen(event.currentTarget.closest("section")?.querySelector(".cover") ?? null)
            }
          >
            Continue · {percent}
          </button>
        </div>
      </div>
    </section>
  );
}
