import { titleInSeries } from "@/lib/shelf";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import { Bars2Icon, PlusIcon, XMarkIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { Series } from "@/domain/book";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { AddToSeries } from "./_AddToSeries";
import { SeriesHeader } from "./_SeriesHeader";

// Edits only, as nothing is stored until Save. Cancel keeps the series as it was.
export function SeriesSheet({
  series,
  stored,
  cards,
  groups,
  onSave,
  onRemove,
  onClose,
}: {
  // A null id is a new series, started from the Book sheet with its book.
  series: { id: string | null; name: string; books: ReadonlyArray<LibraryCard> };
  // The stored record, for the model's unsure books and the numbers that place them.
  stored: Series | undefined;
  cards: Shelf["cards"];
  groups: Shelf["series"];
  onSave: (edit: {
    id: string | null;
    name: string;
    books: ReadonlyArray<string>;
    removed: ReadonlyArray<string>;
    color: number | undefined;
    cover: string | null;
    image: Blob | undefined;
  }) => void;
  onRemove: (id: string, name: string) => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [name, setName] = useState(series.name);
  // Unset until the reader picks one, so the series keeps its turn in the palette.
  const [color, setColor] = useState(stored?.color);
  const shownColor = color ?? groups.find((group) => group.id === series.id)?.color;
  // A book's id, "image" for the reader's own picture, or unset for the book in progress.
  const [cover, setCover] = useState(stored?.cover);
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const pictureUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (pictureUrl.current !== null) URL.revokeObjectURL(pictureUrl.current);
    },
    [],
  );

  const [order, setOrder] = useState(() => series.books.map((card) => card.book.id));
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
    startY: number;
    dy: number;
    height: number;
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  const dropTo = useRef(0);

  // A row moved by a key goes out of the DOM and comes back, so its handle takes the focus again.
  useLayoutEffect(() => {
    if (refocus.current === null) return;

    handles.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [order]);

  const rows = order.flatMap((id) => {
    const card = cards.get(id);
    return card === undefined ? [] : [card];
  });
  const ids = rows.map((card) => card.book.id);
  const author = [...rows, ...series.books].find((card) => card.book.author !== undefined)?.book
    .author;
  // The picture the library shows: the reader's choice, else the book in progress, else the first.
  const front = frontCover(series.id, cover, rows);
  const possible = possibleRows(stored, rows, ids, cards);

  const move = (from: number, to: number): void => {
    const next = [...ids];
    const [id] = next.splice(from, 1);

    if (id === undefined) return;

    next.splice(to, 0, id);
    setOrder(next);
    setAnnouncement(`${cards.get(id)?.book.title ?? ""}, ${to + 1} of ${next.length}`);
  };

  const save = (): void =>
    dismiss(() =>
      onSave({
        id: series.id,
        name,
        books: ids,
        removed: series.books.map((card) => card.book.id).filter((id) => !ids.includes(id)),
        color,
        // A book taken out of the series cannot be its cover.
        cover: cover === "image" || (cover !== undefined && ids.includes(cover)) ? cover : null,
        image: cover === "image" ? picture?.file : undefined,
      }),
    );

  return (
    <>
      <Panel
        sheetRef={sheetRef}
        backdropRef={backdropRef}
        isWide
        label="Series"
        title="Series"
        onDismiss={() => dismiss()}
        foot={
          <div className="flex gap-2.5">
            <button type="button" className="key flex-1" onClick={() => dismiss()}>
              Cancel
            </button>
            <button
              type="button"
              className="key green flex-1"
              disabled={name.trim() === ""}
              onClick={save}
            >
              Save
            </button>
          </div>
        }
      >
        <SeriesHeader
          cover={cover}
          picture={picture}
          front={front}
          seriesId={series.id}
          name={name}
          onName={setName}
          bookCount={rows.length}
          shownColor={shownColor}
          onColor={setColor}
          ids={ids}
          cards={cards}
          storedCover={stored?.cover}
          onCover={setCover}
          pictureUrl={pictureUrl}
          onPicture={setPicture}
        />
        <h3 className="section-title">Books</h3>
        <ul className="rows">
          {rows.map((card, index) => {
            const lifted = drag?.id === card.book.id;
            // The rows between the lifted one and its new place move one row to make room.
            const shift =
              drag === null || lifted
                ? 0
                : drag.from < index && index <= drag.to
                  ? -drag.height
                  : drag.to <= index && index < drag.from
                    ? drag.height
                    : 0;

            return (
              <li
                key={card.book.id}
                className={`row-item relative gap-2.5 px-2.5 ${lifted ? "z-10 bg-(--surface) shadow-xl" : drag !== null ? "motion-safe:transition-transform motion-safe:duration-150" : ""}`}
                style={{
                  transform: lifted
                    ? `translateY(${drag.dy}px) scale(1.02)`
                    : shift === 0
                      ? undefined
                      : `translateY(${shift}px)`,
                }}
              >
                {/* touch-none and data-drag-handle: the list does not scroll and the sheet does not close. */}
                <button
                  type="button"
                  ref={(element) => {
                    if (element === null) return;

                    handles.current.set(card.book.id, element);

                    return () => {
                      handles.current.delete(card.book.id);
                    };
                  }}
                  data-drag-handle
                  className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-(--ink-soft) select-none focus-visible:outline-2 focus-visible:outline-(--green)"
                  aria-label={`Move ${card.book.title}`}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;

                    event.currentTarget.setPointerCapture(event.pointerId);
                    dropTo.current = index;
                    setDrag({
                      id: card.book.id,
                      from: index,
                      to: index,
                      startY: event.clientY,
                      dy: 0,
                      height: Math.max(1, event.currentTarget.closest("li")?.offsetHeight ?? 1),
                    });
                  }}
                  onPointerMove={(event) => {
                    if (drag?.id !== card.book.id) return;

                    const dy = Math.max(
                      -drag.from * drag.height,
                      Math.min(
                        (rows.length - 1 - drag.from) * drag.height,
                        event.clientY - drag.startY,
                      ),
                    );

                    dropTo.current = drag.from + Math.round(dy / drag.height);
                    setDrag({ ...drag, dy, to: dropTo.current });
                  }}
                  onPointerUp={() => {
                    if (drag === null) return;
                    if (dropTo.current !== drag.from) move(drag.from, dropTo.current);
                    setDrag(null);
                  }}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

                    event.preventDefault();

                    const to = index + (event.key === "ArrowUp" ? -1 : 1);

                    if (to < 0 || to >= rows.length) return;

                    refocus.current = card.book.id;
                    move(index, to);
                  }}
                >
                  <Bars2Icon className="icon" />
                </button>
                <span className="book w-8 shrink-0">
                  <BookCover book={card.book} />
                </span>
                <span className="row-label truncate">
                  {index + 1}. {titleInSeries(card.book.title, name)}
                </span>
                <button
                  type="button"
                  className="key small square"
                  aria-label={`Remove ${card.book.title}`}
                  onClick={() => setOrder(ids.filter((id) => id !== card.book.id))}
                >
                  <XMarkIcon className="icon size-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="key mt-3 w-full" onClick={() => setPicking(true)}>
          <PlusIcon className="icon" />
          Add book
        </button>
        {possible.length > 0 && (
          <>
            <h3 className="section-title">Suggested</h3>
            <ul className="rows">
              {possible.map(({ card, index }) => (
                <li key={card.book.id} className="row-item gap-2.5 px-2.5">
                  <span className="book w-8 shrink-0">
                    <BookCover book={card.book} />
                  </span>
                  <span className="row-label flex min-w-0 flex-col">
                    <span className="truncate [direction:rtl]">
                      <bdi dir="ltr">{card.book.title}</bdi>
                    </span>
                    {rows.length > 0 && (
                      <span className="flex min-w-0 gap-1 text-[13.5px] font-normal text-(--ink-soft)">
                        <span className="shrink-0">{index === 0 ? "Before" : "After"}</span>
                        <span className="min-w-0 truncate text-left [direction:rtl]">
                          <bdi dir="ltr">{rows[index === 0 ? 0 : index - 1]?.book.title}</bdi>
                        </span>
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="key small square"
                    aria-label={`Add ${card.book.title}`}
                    onClick={() =>
                      setOrder([...ids.slice(0, index), card.book.id, ...ids.slice(index)])
                    }
                  >
                    <PlusIcon className="icon size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {series.id !== null && (
          <button
            type="button"
            className="key danger-outline mt-7 w-full"
            onClick={() => {
              const id = series.id;

              if (id !== null) dismiss(() => onRemove(id, series.name));
            }}
          >
            Delete series
          </button>
        )}
      </Panel>

      {picking && (
        <AddToSeries
          name={name}
          seriesId={series.id}
          author={author}
          exclude={ids}
          cards={cards}
          groups={groups}
          onAdd={(added) => setOrder([...ids, ...added])}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function frontCover(
  seriesId: string | null,
  cover: string | undefined,
  rows: ReadonlyArray<LibraryCard>,
): string | undefined {
  if (cover === "image") return `series:${seriesId}`;

  return cover ?? (rows.find((card) => card.status === "reading") ?? rows[0])?.book.id;
}

function possibleRows(
  stored: Series | undefined,
  rows: ReadonlyArray<LibraryCard>,
  ids: ReadonlyArray<string>,
  cards: Shelf["cards"],
): Array<{ card: LibraryCard; index: number }> {
  return (stored?.possible ?? []).flatMap(({ id, number }) => {
    const card = cards.get(id);

    if (card === undefined || ids.includes(id)) return [];

    // The number only places the book: before the first book with a higher one, else at the end.
    const before =
      number === undefined
        ? -1
        : rows.findIndex(
            (row) =>
              (stored?.books.find((entry) => entry.id === row.book.id)?.number ??
                row.book.seriesNumber ??
                -Infinity) > number,
          );

    return [{ card, index: before === -1 ? rows.length : before }];
  });
}
