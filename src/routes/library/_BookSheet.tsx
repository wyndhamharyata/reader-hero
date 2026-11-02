import { useRef, useState, type ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import { CheckIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import { Switch } from "@/components/Switch";
import type { ReadingProgress } from "@/domain/book";
import { formatPercent, formatSize } from "@/lib/format";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

export function BookSheet({
  card,
  progress,
  groups,
  onOpen,
  onFinished,
  onSeries,
  onEditSeries,
  onRemove,
  onReparse,
  onCover,
  onResetCover,
  onClose,
}: {
  card: LibraryCard;
  progress: ReadingProgress | null;
  groups: Shelf["series"];
  onOpen: () => void;
  // `place` is the position at the sheet's opening, which Finished turned off goes back to.
  onFinished: (id: string, isFinished: boolean, place: ReadingProgress | null) => void;
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
  onCover: (id: string, picture: File) => void;
  onResetCover: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [isFinished, setFinished] = useState(card.status === "finished");
  // Set by the switch, so the stamp thumps on a change and not when the sheet opens.
  const [hasStamped, setStamped] = useState(false);
  const [isConfirming, setConfirming] = useState(false);
  const [place] = useState(progress);
  // The sheet keeps the card it opened with, so Reset follows the choices made in it.
  const [custom, setCustom] = useState(card.book.customCover === true);
  // A choice shows until the library reads the store again. From then the stored series shows.
  const [choice, setChoice] = useState<{
    seriesId: string | null;
    groups: Shelf["series"];
  } | null>(null);
  const { book } = card;
  const current = groups.find((group) => group.books.some((entry) => entry.book.id === book.id));
  const seriesId =
    choice !== null && choice.groups === groups ? choice.seriesId : (current?.id ?? null);
  const seriesName = groups.find((entry) => entry.id === seriesId)?.name ?? "None";
  const isStarted = card.status !== "not-started" || isFinished;

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Book"
      title="Book"
      onDismiss={() => dismiss()}
    >
      <BookHead
        card={card}
        isFinished={isFinished}
        hasStamped={hasStamped}
        percent={isFinished ? 1 : (place?.percent ?? 0)}
      />
      <button type="button" className="key green w-full" onClick={() => dismiss(onOpen)}>
        {isStarted ? "Continue reading" : "Start reading"}
      </button>
      <div className="rows mt-4.5">
        <div className="row-item">
          <span className="row-label">Finished</span>
          <Switch
            isOn={isFinished}
            label="Finished"
            onChange={(next) => {
              setFinished(next);
              setStamped(true);
              onFinished(book.id, next, place);
            }}
          />
        </div>
        {/* WebKit runs a select's text under its arrow, so the name shows in the row under a clear select. */}
        <label className="row-item relative cursor-pointer">
          <span className="row-label">Series</span>
          <span className="value">{seriesName}</span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
          <select
            className="absolute inset-0 cursor-pointer opacity-0"
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
              onSeries(book.id, next);
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
        </label>
        <div className="row-item">
          <span className="row-label">Cover</span>
          {custom && (
            <button
              type="button"
              className="key small"
              onClick={() => {
                setCustom(false);
                onResetCover(book.id);
              }}
            >
              Reset
            </button>
          )}
          <label className="key small has-focus-visible:outline-2 has-focus-visible:outline-(--green)">
            Change
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const picture = event.target.files?.[0];

                event.target.value = "";
                if (picture === undefined) return;

                setCustom(true);
                onCover(book.id, picture);
              }}
            />
          </label>
        </div>
        <div className="row-item">
          <span className="row-label">Reader view</span>
          <button
            type="button"
            className="key small"
            onClick={() => dismiss(() => onReparse(book.id))}
          >
            Rebuild
          </button>
        </div>
      </div>
      {isConfirming ? (
        <div className="confirm">
          <p>Delete {book.title} and its summary?</p>
          <div className="buttons">
            <button type="button" className="key small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="key small danger"
              onClick={() => dismiss(() => onRemove(book.id))}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="key danger-outline mt-7 w-full"
          onClick={() => setConfirming(true)}
        >
          Delete book
        </button>
      )}
    </Panel>
  );
}

// The cover with its ribbon or stamp, then what the book is.
function BookHead({
  card,
  isFinished,
  hasStamped,
  percent,
}: {
  readonly card: LibraryCard;
  readonly isFinished: boolean;
  readonly hasStamped: boolean;
  readonly percent: number;
}): ReactElement {
  const { book } = card;
  const isReading = card.status !== "not-started" && !isFinished;
  const meta = [
    book.format === "epub" ? "EPUB" : "PDF",
    formatPercent(percent),
    formatSize(book.fileSize),
  ].join(" · ");

  return (
    <div className="flex items-end gap-4.5 pt-1.5 pb-4.5">
      <span className="book w-24 shrink-0">
        <BookCover book={book} />
        {isReading && <span className="ribbon" />}
        {isFinished && (
          <span className={hasStamped ? "stamp thump" : "stamp"}>
            <CheckIcon className="icon" />
          </span>
        )}
      </span>
      <div className="min-w-0">
        <h2 className="line-clamp-4 font-serif text-[21px] leading-tight font-bold break-words">
          {book.title}
        </h2>
        {book.author !== undefined && (
          <p className="mt-1 text-[13.5px] text-(--ink-soft)">{book.author}</p>
        )}
        <p className="mt-1 text-[13.5px] text-(--ink-soft)">{meta}</p>
      </div>
    </div>
  );
}
