import type { Virtualizer } from "@tanstack/react-virtual";
import type { CSSProperties, ReactElement } from "react";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { BookTile } from "./_BookTile";
import { SeriesTile } from "./_SeriesTile";

type ShelfItem = Shelf["items"][number];
type SeriesItem = Shelf["series"][number];

export type ShelfRow =
  | { readonly kind: "books"; readonly items: ReadonlyArray<ShelfItem>; readonly first: number }
  | { readonly kind: "tray"; readonly series: SeriesItem };

// An open series' tray goes under the row that holds its slipcase, across the whole row.
export function shelfRows(
  items: ReadonlyArray<ShelfItem>,
  columns: number,
  openSeries: ReadonlySet<string>,
): ReadonlyArray<ShelfRow> {
  const rows: Array<ShelfRow> = [];

  for (let first = 0; first < items.length; first += columns) {
    const row = items.slice(first, first + columns);

    rows.push({ kind: "books", items: row, first });

    for (const item of row) {
      if (item.kind === "series" && openSeries.has(item.id))
        rows.push({ kind: "tray", series: item });
    }
  }

  return rows;
}

// By content, not place, so an opened tray does not hand its height to the rows after it.
export function rowKey(row: ShelfRow | undefined, index: number): string {
  if (row === undefined) return `${index}`;
  if (row.kind === "tray") return `tray:${row.series.id}`;

  const first = row.items[0];

  return first?.kind === "series" ? `series:${first.id}` : `book:${first?.card.book.id ?? index}`;
}

const dealStepMs = 30;
// The tray's first row slides out of the case, as many volumes as the width shows. The rows under it are there at once.
const unpackStepMs = 30;
const lastDealt = 9;

export interface TileEvents {
  readonly onOpen: (card: LibraryCard, cover: Element | null) => void;
  readonly onBookActions: (card: LibraryCard) => void;
  readonly onToggleSeries: (id: string) => void;
  readonly onSeriesActions: (series: SeriesItem) => void;
  // How far the import has read a building book, by its id.
  readonly fillOf: (card: LibraryCard) => number;
  readonly isFresh: (id: string) => boolean;
}

export function LibraryRows({
  virtualizer,
  rows,
  columns,
  listTop,
  isDealing,
  openSeries,
  events,
}: {
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  readonly rows: ReadonlyArray<ShelfRow>;
  readonly columns: number;
  readonly listTop: number;
  readonly isDealing: boolean;
  readonly openSeries: ReadonlySet<string>;
  readonly events: TileEvents;
}): ReactElement {
  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  const bookTile = (
    card: LibraryCard,
    index: number,
    place?: number,
    seriesName?: string,
  ): ReactElement => (
    <BookTile
      key={`book:${card.book.id}`}
      card={card}
      place={place}
      seriesName={seriesName}
      fill={events.fillOf(card)}
      motion={
        place === undefined
          ? motionFor(events.isFresh(card.book.id), isDealing, index)
          : place <= columns
            ? { name: "unpack", delayMs: (place - 1) * unpackStepMs }
            : null
      }
      onOpen={(cover) => events.onOpen(card, cover)}
      onActions={() => events.onBookActions(card)}
    />
  );

  return (
    <>
      {virtualizer.getVirtualItems().map((virtual) => {
        const row = rows[virtual.index];
        const style: CSSProperties = { transform: `translateY(${virtual.start - listTop}px)` };

        if (row === undefined) return null;

        return (
          <div
            key={virtual.key}
            ref={virtualizer.measureElement}
            data-index={virtual.index}
            // Close over an open tray, so the tray reads as coming out of the case above it.
            className={`absolute inset-x-0 top-0 ${rows[virtual.index + 1]?.kind === "tray" ? "pb-3" : "pb-6 md:pb-7.5"}`}
            style={style}
          >
            {row.kind === "tray" ? (
              <SeriesTray
                series={row.series}
                columns={columns}
                onEdit={() => events.onSeriesActions(row.series)}
                onClose={() => events.onToggleSeries(row.series.id)}
              >
                {row.series.books.map((card, index) =>
                  bookTile(card, -1, index + 1, row.series.name),
                )}
              </SeriesTray>
            ) : (
              <ul className="grid gap-x-4.5 md:gap-x-6.5" style={gridStyle}>
                {row.items.map((item, column) => {
                  const index = row.first + column;

                  if (item.kind === "book") return bookTile(item.card, index);

                  return (
                    <SeriesTile
                      key={`series:${item.id}`}
                      series={item}
                      isOpen={openSeries.has(item.id)}
                      motion={motionFor(false, isDealing, index)}
                      onToggle={() => events.onToggleSeries(item.id)}
                      onActions={() => events.onSeriesActions(item)}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

function motionFor(
  isFresh: boolean,
  isDealing: boolean,
  index: number,
): { readonly name: "drop" | "deal"; readonly delayMs: number } | null {
  if (isFresh) return { name: "drop", delayMs: 0 };
  if (!isDealing || index < 0) return null;

  return { name: "deal", delayMs: Math.min(index, lastDealt) * dealStepMs };
}

function SeriesTray({
  series,
  columns,
  onEdit,
  onClose,
  children,
}: {
  readonly series: SeriesItem;
  readonly columns: number;
  readonly onEdit: () => void;
  readonly onClose: () => void;
  readonly children: ReadonlyArray<ReactElement>;
}): ReactElement {
  const style = { "--hue": series.color } as CSSProperties;

  return (
    <section className="tray" style={style} aria-label={series.name}>
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-bold">{series.name}</h3>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="key small" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="key small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {/* The shelf's columns, so a volume reads at the size of a book on the shelf. */}
      <ul
        className="tray-books grid gap-x-4.5 gap-y-6 md:gap-x-6.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {children}
      </ul>
    </section>
  );
}
