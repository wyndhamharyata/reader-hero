import { useRef, useState, type ReactElement } from "react";
import { BookCover } from "@/components/BookCover";
import { CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

// Over the Series sheet, so the marked books join its order and are stored only on its Save.
export function AddToSeries({
  name,
  seriesId,
  author,
  exclude,
  cards,
  groups,
  onAdd,
  onClose,
}: {
  name: string;
  seriesId: string | null;
  // The series' author, whose books come first, so a picker needs no typing.
  author: string | undefined;
  exclude: ReadonlyArray<string>;
  cards: Shelf["cards"];
  groups: Shelf["series"];
  onAdd: (ids: ReadonlyArray<string>) => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [query, setQuery] = useState("");
  const [marked, setMarked] = useState<ReadonlyArray<string>>([]);
  const terms = query
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");
  const shown = [...cards.values()]
    .filter(
      (card) =>
        !exclude.includes(card.book.id) &&
        terms.every((term) =>
          `${card.book.title} ${card.book.author ?? ""}`.toLowerCase().includes(term),
        ),
    )
    .sort((a, b) =>
      a.book.title.localeCompare(b.book.title, undefined, { numeric: true, sensitivity: "base" }),
    );
  const sections = [
    {
      label: author ?? "",
      cards: shown.filter((card) => author !== undefined && card.book.author === author),
    },
    {
      label: "Other books",
      cards: shown.filter((card) => author === undefined || card.book.author !== author),
    },
  ].filter((section) => section.cards.length > 0);

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Add book"
      title={`Add to ${name.trim() === "" ? "series" : name.trim()}`}
      onDismiss={() => dismiss()}
      foot={
        <div className="flex gap-2.5">
          <button type="button" className="key flex-1" onClick={() => dismiss()}>
            Cancel
          </button>
          <button
            type="button"
            className="key green flex-1"
            disabled={marked.length === 0}
            onClick={() => dismiss(() => onAdd(marked))}
          >
            {marked.length === 0
              ? "Add book"
              : `Add ${marked.length} ${marked.length === 1 ? "book" : "books"}`}
          </button>
        </div>
      }
    >
      <label className="field mb-2">
        <MagnifyingGlassIcon className="icon text-(--ink-soft)" />
        <input
          type="search"
          placeholder="Search books"
          aria-label="Search books"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {sections.length === 0 && <p className="pt-2 text-(--ink-soft)">No books</p>}
      {sections.map((section) => (
        <section key={section.label}>
          <h3 className="section-title">{section.label}</h3>
          <ul className="rows">
            {section.cards.map((card) => {
              const picked = marked.includes(card.book.id);
              const other =
                card.seriesId === undefined || card.seriesId === seriesId
                  ? undefined
                  : groups.find((group) => group.id === card.seriesId);
              const line = [
                ...(card.book.author === undefined ? [] : [card.book.author]),
                ...(other === undefined
                  ? []
                  : [
                      `${other.name} · ${other.books.findIndex((entry) => entry.book.id === card.book.id) + 1} of ${other.count}`,
                    ]),
              ].join(" · ");

              return (
                <li key={card.book.id}>
                  <button
                    type="button"
                    aria-pressed={picked}
                    className={`row-item gap-3 px-2.5 ${picked ? "bg-(--green-wash)" : ""}`}
                    onClick={() =>
                      setMarked(
                        picked
                          ? marked.filter((id) => id !== card.book.id)
                          : [...marked, card.book.id],
                      )
                    }
                  >
                    <span className="book w-8 shrink-0">
                      <BookCover book={card.book} />
                    </span>
                    <span className="row-label flex min-w-0 flex-col">
                      <span className="truncate">{card.book.title}</span>
                      {line !== "" && (
                        <span className="truncate text-[13.5px] font-normal text-(--ink-soft)">
                          {line}
                        </span>
                      )}
                    </span>
                    {picked && <CheckIcon className="icon text-(--green)" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Panel>
  );
}
