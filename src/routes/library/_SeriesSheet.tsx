import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Bars2Icon, PlusIcon, XMarkIcon } from "@/components/icons";
import type { Series } from "@/domain/book";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { AddToSeries } from "./_AddToSeries";
import { BookCover } from "./_BookCover";

// Edits only, and nothing is stored until Save, so Cancel leaves the series as it was.
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
  }) => void;
  onRemove: (id: string, name: string) => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [name, setName] = useState(series.name);
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

  // A row moved by a key leaves the DOM and comes back, so its handle takes the focus again.
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
  const possible = (stored?.possible ?? []).flatMap(({ id, number }) => {
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

  const move = (from: number, to: number): void => {
    const next = [...ids];
    const [id] = next.splice(from, 1);
    if (id === undefined) return;
    next.splice(to, 0, id);
    setOrder(next);
    setAnnouncement(`${cards.get(id)?.book.title ?? ""}, ${to + 1} of ${next.length}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Series"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col gap-2 rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-[28rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Series</p>
        <input
          type="text"
          className="input w-full shrink-0 text-base md:text-sm md:input-sm"
          placeholder="Name"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="-mx-4 min-h-0 overflow-y-auto overscroll-contain">
          <ul className="pt-1">
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
                  className={`relative px-4 ${lifted ? "z-10" : drag !== null ? "motion-safe:transition-transform motion-safe:duration-150" : ""}`}
                  style={{
                    transform: lifted
                      ? `translateY(${drag.dy}px)`
                      : shift === 0
                        ? undefined
                        : `translateY(${shift}px)`,
                  }}
                >
                  <div
                    className={`flex items-center gap-2 rounded-field py-0.5 ${lifted ? "scale-[1.02] bg-(--sheet) shadow-xl" : ""}`}
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
                      className="btn btn-square cursor-grab touch-none btn-ghost select-none md:btn-sm"
                      aria-label={`Move ${card.book.title}`}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      title="Move"
                      onPointerDown={(event) => {
                        if (!event.isPrimary || event.button !== 0) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
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
                        setDrag({ ...drag, dy, to: drag.from + Math.round(dy / drag.height) });
                      }}
                      onPointerUp={() => {
                        if (drag === null) return;
                        if (drag.to !== drag.from) move(drag.from, drag.to);
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
                      <Bars2Icon className="size-6 opacity-60 md:size-4" />
                    </button>
                    <div className="w-8 shrink-0">
                      <BookCover bookId={card.book.id} rounded="rounded-md" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-base font-medium md:text-sm">
                      {card.book.title}
                    </span>
                    <button
                      type="button"
                      className="btn btn-square btn-ghost md:btn-sm"
                      aria-label={`Remove ${card.book.title}`}
                      title="Remove"
                      onClick={() => setOrder(ids.filter((id) => id !== card.book.id))}
                    >
                      <XMarkIcon className="size-6 md:size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className={`px-2 ${possible.length === 0 ? "pb-1" : ""}`}>
            <button
              type="button"
              className="btn w-full justify-start btn-ghost px-2 md:btn-sm"
              onClick={() => setPicking(true)}
            >
              <PlusIcon className="size-6 opacity-60 md:size-4" />
              Add book
            </button>
          </div>
          {possible.length > 0 && (
            <>
              <p className="mt-2 px-4 text-xs font-medium tracking-wide uppercase opacity-60">
                Possible
              </p>
              <ul className="pb-1">
                {possible.map(({ card, index }) => (
                  <li key={card.book.id} className="flex items-center gap-3 px-4 py-0.5">
                    <div className="w-8 shrink-0">
                      <BookCover bookId={card.book.id} rounded="rounded-md" />
                    </div>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium md:text-sm">
                        {card.book.title}
                      </span>
                      {rows.length > 0 && (
                        <span className="truncate text-base opacity-60 md:text-sm">
                          {index === 0
                            ? `Before ${rows[0]?.book.title}`
                            : `After ${rows[index - 1]?.book.title}`}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn-square btn-ghost md:btn-sm"
                      aria-label={`Add ${card.book.title}`}
                      title="Add"
                      onClick={() =>
                        setOrder([...ids.slice(0, index), card.book.id, ...ids.slice(index)])
                      }
                    >
                      <PlusIcon className="size-6 md:size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          {series.id !== null && (
            <button
              type="button"
              className="btn btn-ghost text-error md:btn-sm"
              onClick={() => {
                const id = series.id;
                if (id !== null) dismiss(() => onRemove(id, series.name));
              }}
            >
              Remove series
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn btn-ghost md:btn-sm" onClick={() => dismiss()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary md:btn-sm"
            disabled={name.trim() === ""}
            onClick={() =>
              dismiss(() =>
                onSave({
                  id: series.id,
                  name,
                  books: ids,
                  removed: series.books
                    .map((card) => card.book.id)
                    .filter((id) => !ids.includes(id)),
                }),
              )
            }
          >
            Save
          </button>
        </div>
      </aside>

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
    </div>
  );
}
