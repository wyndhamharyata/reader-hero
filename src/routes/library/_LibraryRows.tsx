import type { Virtualizer } from "@tanstack/react-virtual";
import type { ReactElement } from "react";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { BookCard } from "./_BookCard";
import { BookTile } from "./_BookTile";
import { SeriesCard } from "./_SeriesCard";
import { SeriesTile } from "./_SeriesTile";
import type { TrayFlags } from "./_TrayPart";

export type LibraryRowItem =
  Shelf["items"][number] | { readonly kind: "member"; readonly card: LibraryCard };

export function LibraryRows({
  virtualizer,
  rows,
  columns,
  isGrid,
  listTop,
  trays,
  openSeries,
  onToggleSeries,
  onSeriesActions,
  onBookActions,
}: {
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  readonly rows: ReadonlyArray<ReadonlyArray<LibraryRowItem>>;
  readonly columns: number;
  readonly isGrid: boolean;
  readonly listTop: number;
  readonly trays: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly hue: number;
  }>;
  readonly openSeries: ReadonlySet<string>;
  readonly onToggleSeries: (id: string) => void;
  readonly onSeriesActions: (series: Shelf["series"][number]) => void;
  readonly onBookActions: (card: LibraryCard) => void;
}): ReactElement {
  return (
    <>
      {virtualizer.getVirtualItems().map((row) => (
        <ul
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          {...(row.index === 0 ? { "data-tour": "book" } : {})}
          // Above the next row while a tile's menu is open, so the menu is not under it.
          className={`absolute inset-x-0 top-0 grid gap-x-3 focus-within:z-10 ${isGrid ? "pb-5" : "pb-3"}`}
          style={{
            transform: `translateY(${row.start - listTop}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {rows[row.index]?.map((item, column) => {
            const itemIndex = row.index * columns + column;
            const range = trays.find((entry) => entry.start <= itemIndex && itemIndex <= entry.end);
            const tray: TrayFlags | null =
              range === undefined
                ? null
                : {
                    index: itemIndex,
                    start: range.start,
                    end: range.end,
                    columns,
                    rowGap: isGrid ? "1.25rem" : "0.75rem",
                    hue: range.hue,
                  };

            if (item.kind === "series") {
              const props = {
                series: item,
                isExpanded: openSeries.has(item.id),
                onToggle: () => onToggleSeries(item.id),
                onActions: () => onSeriesActions(item),
                tray,
              };

              return isGrid ? (
                <SeriesTile key={`series:${item.id}`} {...props} />
              ) : (
                <SeriesCard key={`series:${item.id}`} {...props} />
              );
            }

            const isSeriesMember = item.kind === "member";
            const props = {
              card: item.card,
              onActions: () => onBookActions(item.card),
              isSeriesMember,
              tray,
            };

            return isGrid ? (
              <BookTile key={`book:${item.card.book.id}`} {...props} />
            ) : (
              <BookCard key={`book:${item.card.book.id}`} {...props} />
            );
          })}
        </ul>
      ))}
    </>
  );
}
