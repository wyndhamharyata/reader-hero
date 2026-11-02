import type { CSSProperties, ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import type { BookMeta } from "@/domain/book";
import type { Shelf } from "@/lib/shelf";
import { useLongPress } from "@/lib/use-long-press";

type SeriesItem = Shelf["series"][number];

// The reader's own picture, else the chosen book, else the book in progress, else the first.
export function seriesFront(
  series: Pick<SeriesItem, "id" | "name" | "cover" | "books" | "inProgress">,
): Pick<BookMeta, "id" | "title" | "author" | "format"> | undefined {
  if (series.cover === "image")
    return { id: `series:${series.id}`, title: series.name, format: "epub" };

  const card =
    series.books.find((entry) => entry.book.id === series.cover) ??
    series.inProgress ??
    series.books[0];

  return card?.book;
}

// A slipcase: two volumes fanned behind the front one, with a tab that counts them.
export function SeriesTile({
  series,
  isOpen,
  motion,
  onToggle,
  onActions,
}: {
  readonly series: SeriesItem;
  readonly isOpen: boolean;
  readonly motion: { readonly name: "drop" | "deal"; readonly delayMs: number } | null;
  readonly onToggle: () => void;
  readonly onActions: () => void;
}): ReactElement {
  const press = useLongPress(onActions);
  const front = seriesFront(series);
  const [near, far] = series.books.filter((card) => card.book.id !== front?.id).slice(0, 2);
  const style = { "--hue": series.color } as CSSProperties;
  const motionStyle: CSSProperties | undefined =
    motion === null ? undefined : { animationDelay: `${motion.delayMs}ms` };

  return (
    <li data-series-root={series.id} className={motion?.name} style={motionStyle}>
      <button
        type="button"
        className="book-link slipcase w-full select-none [-webkit-touch-callout:none]"
        aria-expanded={isOpen}
        aria-label={`${series.name}, ${series.count} books`}
        style={style}
        onClick={onToggle}
        {...press}
      >
        <span className="book">
          <span className="fan">
            {far !== undefined && (
              <span className="far">
                <BookCover book={far.book} />
              </span>
            )}
            {near !== undefined && (
              <span className="near">
                <BookCover book={near.book} />
              </span>
            )}
            {front !== undefined && <BookCover book={front} />}
            {series.status === "reading" && <span className="ribbon" />}
          </span>
          <span className="index-tab">{series.count}</span>
        </span>
        <span className="mt-2.5 line-clamp-2 text-[13.5px] leading-tight font-bold">
          {series.name}
        </span>
        <span className="block truncate text-[12.5px] text-(--ink-soft)">
          {series.finishedCount} of {series.count} read
        </span>
      </button>
    </li>
  );
}
