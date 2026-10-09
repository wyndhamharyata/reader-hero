import { useRef, useState, type ReactElement } from "react";
import { PencilIcon } from "@/components/icons";
import { formatPercent } from "@/lib/format";
import type { ReadingProgress } from "@/domain/book";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

export function BookSheet({
  card,
  progress,
  groups,
  onFinished,
  onSeries,
  onEditSeries,
  onRemove,
  onReparse,
  onClose,
}: {
  card: LibraryCard;
  progress: ReadingProgress | null;
  groups: Shelf["series"];
  // `place` is the position at the sheet's opening, which Finished turned off goes back to.
  onFinished: (id: string, finished: boolean, place: ReadingProgress | null) => void;
  // Null takes the book out of its series.
  onSeries: (id: string, seriesId: string | null) => void;
  // A null id starts a new series with this book.
  onEditSeries: (series: {
    id: string | null;
    name: string;
    books: ReadonlyArray<LibraryCard>;
  }) => void;
  onRemove: (id: string) => void;
  onReparse: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [finished, setFinished] = useState(card.status === "finished");
  const [place] = useState(progress);
  // A choice shows until the library reads the store again; from then the stored series shows.
  const [choice, setChoice] = useState<{
    seriesId: string | null;
    groups: Shelf["series"];
  } | null>(null);
  const current = groups.find((group) =>
    group.books.some((entry) => entry.book.id === card.book.id),
  );
  const seriesId =
    choice !== null && choice.groups === groups ? choice.seriesId : (current?.id ?? null);
  const group = current?.id === seriesId ? current : undefined;
  const note = finished
    ? "Finished puts the saved position at the end. The Summary and the series summary cover the whole book."
    : "The Summary and the series summary stop at the furthest position.";

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
        aria-label="Book"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col gap-2 rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:w-[36rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Book</p>
        <div>
          <h2 className="text-lg font-semibold">{card.book.title}</h2>
          {card.book.author !== undefined && (
            <p className="text-base opacity-70 md:text-sm">{card.book.author}</p>
          )}
        </div>
        <div className="mt-1 divide-y divide-base-content/10 rounded-box bg-base-300">
          {/* A button, not a switch: it moves the saved position. The sheet stays open, so a second tap undoes it. */}
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-base md:px-3 md:py-1.5 md:text-sm">
            <span>{finished ? "Finished" : `${formatPercent(place?.percent ?? 0)} read`}</span>
            <button
              type="button"
              className="btn md:btn-sm"
              onClick={() => {
                setFinished(!finished);
                onFinished(card.book.id, !finished, place);
              }}
            >
              {finished ? "Mark as not finished" : "Mark as finished"}
            </button>
          </div>
          <label className="flex items-center justify-between gap-3 px-4 py-2 text-base md:px-3 md:py-1.5 md:text-sm">
            <span>Series</span>
            {/* WebKit runs a select's text under its arrow, so the name shows in a box under a clear select. */}
            <span className="select relative w-56 min-w-0 text-base md:w-80 md:text-sm md:select-sm">
              <span className="min-w-0 truncate">
                {groups.find((entry) => entry.id === seriesId)?.name ?? "None"}
              </span>
              <select
                className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Series"
                value={seriesId === null ? "none" : `id:${seriesId}`}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "new") {
                    dismiss(() => onEditSeries({ id: null, name: "", books: [card] }));
                    return;
                  }
                  const next = value === "none" ? null : value.slice(3);
                  setChoice({ seriesId: next, groups });
                  onSeries(card.book.id, next);
                }}
              >
                <option value="none">None</option>
                {[...groups]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((entry) => (
                    <option key={entry.id} value={`id:${entry.id}`}>
                      {entry.name}
                    </option>
                  ))}
                <option value="new">New series</option>
              </select>
            </span>
          </label>
          {group !== undefined && (
            <div className="flex items-center justify-between gap-3 py-1 pr-2 pl-4 text-base md:py-0.5 md:pl-3 md:text-sm">
              <span>Place</span>
              <span className="flex items-center gap-1">
                <span className="opacity-70">
                  {group.books.findIndex((entry) => entry.book.id === card.book.id) + 1} of{" "}
                  {group.count}
                </span>
                <button
                  type="button"
                  className="btn btn-square btn-ghost md:btn-sm"
                  aria-label="Edit series"
                  title="Edit series"
                  onClick={() => dismiss(() => onEditSeries(group))}
                >
                  <PencilIcon className="size-6 md:size-4" />
                </button>
              </span>
            </div>
          )}
        </div>
        <p className="text-base opacity-60 md:text-sm">{note}</p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost text-error md:btn-sm"
            onClick={() => dismiss(() => onRemove(card.book.id))}
          >
            Delete
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className="btn btn-ghost md:btn-sm"
            onClick={() => dismiss(() => onReparse(card.book.id))}
          >
            Rebuild
          </button>
          <button type="button" className="btn md:btn-sm" onClick={() => dismiss()}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
