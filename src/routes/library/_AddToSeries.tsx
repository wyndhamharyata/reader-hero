import { useRef, useState, type ReactElement } from "react";
import { CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import type { Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { BookCover } from "./_BookCover";

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
    <div className="absolute inset-0 z-20 flex flex-col justify-end md:items-center md:justify-center">
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
        aria-label="Add book"
        className="relative z-10 mx-auto flex h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col gap-2 rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:h-[min(40rem,85vh)] md:w-[28rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="truncate text-xs font-medium tracking-wide uppercase opacity-60">
          Add to {name.trim() === "" ? "series" : name.trim()}
        </p>
        <label className="input w-full shrink-0 text-base md:text-sm md:input-sm">
          <MagnifyingGlassIcon className="size-5 opacity-50 md:size-4" />
          <input
            type="search"
            className="grow"
            placeholder="Search title, author…"
            aria-label="Search books"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
          {sections.length === 0 && (
            <p className="px-4 pt-2 text-base opacity-70 md:text-sm">No books</p>
          )}
          {sections.map((section) => (
            <section key={section.label}>
              <p className="mt-2 px-4 text-xs font-medium tracking-wide uppercase opacity-60">
                {section.label}
              </p>
              <ul className="mt-1">
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
                    <li key={card.book.id} className="px-2">
                      <button
                        type="button"
                        aria-pressed={picked}
                        className={`flex w-full items-center gap-3 rounded-field px-2 py-1.5 text-left ${picked ? "bg-primary/10" : "hover:bg-base-300"}`}
                        onClick={() =>
                          setMarked(
                            picked
                              ? marked.filter((id) => id !== card.book.id)
                              : [...marked, card.book.id],
                          )
                        }
                      >
                        <div className="w-8 shrink-0">
                          <BookCover bookId={card.book.id} rounded="rounded-md" />
                        </div>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-base font-medium md:text-sm">
                            {card.book.title}
                          </span>
                          {line !== "" && (
                            <span className="truncate text-base opacity-60 md:text-sm">{line}</span>
                          )}
                        </span>
                        {picked && <CheckIcon className="size-6 shrink-0 text-primary md:size-5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-1 flex shrink-0 gap-2">
          <button type="button" className="btn btn-ghost md:btn-sm" onClick={() => dismiss()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn flex-1 btn-primary md:btn-sm"
            disabled={marked.length === 0}
            onClick={() => dismiss(() => onAdd(marked))}
          >
            {marked.length === 0
              ? "Add book"
              : `Add ${marked.length} ${marked.length === 1 ? "book" : "books"}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
