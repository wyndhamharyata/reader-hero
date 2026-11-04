import { useMemo, useRef, type ReactElement } from "react";
import { Panel } from "@/components/Panel";
import type { Annotation } from "@/domain/annotation";
import type { BookMeta } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

// Every highlight, by book, so the library opens one as it would open the book.
export function HighlightsSheet({
  annotations,
  books,
  bookId,
  onOpen,
  onClose,
}: {
  readonly annotations: ReadonlyArray<Annotation>;
  readonly books: ReadonlyArray<BookMeta>;
  // A book's own list, or every book's.
  readonly bookId?: string | undefined;
  readonly onOpen: (annotation: Annotation) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const titles = useMemo(
    () => new Map(books.map((book) => [book.id, book.title] as const)),
    [books],
  );
  const groups = useMemo(() => {
    const shown =
      bookId === undefined
        ? annotations
        : annotations.filter((annotation) => annotation.bookId === bookId);
    const byBook = new Map<string, { latest: number; items: Array<Annotation> }>();

    for (const annotation of shown) {
      const group = byBook.get(annotation.bookId) ?? { latest: 0, items: [] };

      group.items.push(annotation);
      group.latest = Math.max(group.latest, annotation.updatedAt);
      byBook.set(annotation.bookId, group);
    }

    return [...byBook.entries()]
      .sort(([, a], [, b]) => b.latest - a.latest)
      .map(([id, group]) => ({
        id,
        title: titles.get(id) ?? "",
        items: [...group.items].sort(
          (a, b) => a.from.block - b.from.block || a.from.offset - b.from.offset,
        ),
      }));
  }, [annotations, bookId, titles]);

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Highlights"
      title="Highlights"
      onDismiss={() => dismiss()}
    >
      <ul className="flex flex-col">
        {annotations.length === 0 && <li className="py-3 text-(--ink-soft)">No highlights yet</li>}
        {groups.map((group) => (
          <li key={group.id} className="first:-mt-3">
            {bookId === undefined && group.title !== "" && (
              <h3 className="section-title">{group.title}</h3>
            )}
            <ul>
              {group.items.map((annotation) => (
                <li key={annotation.id} className="border-t border-(--line)">
                  <button
                    type="button"
                    className="block w-full py-3 text-left"
                    onClick={() => dismiss(() => onOpen(annotation))}
                  >
                    <span className="line-clamp-3 block border-l-4 border-(--hl) pl-2 font-serif text-[15px] leading-snug">
                      {annotation.quote.join(" ")}
                    </span>
                    {annotation.note !== undefined && (
                      <span className="mt-1 line-clamp-2 block text-[13.5px] text-(--ink-soft)">
                        {annotation.note}
                      </span>
                    )}
                    <span className="mt-1 block text-right text-[12.5px] text-(--ink-soft) tabular-nums">
                      p. {annotation.page}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
