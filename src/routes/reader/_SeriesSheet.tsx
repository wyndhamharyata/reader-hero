import { useRef, type ReactElement } from "react";
import { BookOpenIcon, XMarkIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";
import type { Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

// Another book opens over this one, so Back in it returns here.
export function SeriesSheet({
  series,
  bookId,
  onClose,
}: {
  series: Shelf["series"][number];
  bookId: string;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
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
        aria-label="Series"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-[28rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="truncate text-xs font-medium tracking-wide uppercase opacity-60">
          Series · {series.name}
        </p>

        <ul className="-mx-4 mt-2 min-h-0 overflow-y-auto overscroll-contain py-1">
          {series.books.map((card, index) => {
            const current = card.book.id === bookId;
            const row = (
              <>
                <span className="w-8 shrink-0 tabular-nums opacity-60">{index + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="w-full truncate font-medium">{card.book.title}</span>
                  <span className={card.badge.className}>{card.badge.label}</span>
                </span>
                {!current && <BookOpenIcon className="size-5 shrink-0 opacity-60 md:size-4" />}
              </>
            );
            return (
              <li key={card.book.id} className="px-2">
                {current ? (
                  <div
                    aria-current="true"
                    className="flex items-center gap-2 rounded-field px-2 py-2 text-base md:text-sm"
                  >
                    {row}
                  </div>
                ) : (
                  <SlideLink
                    to={`/book/${card.book.id}`}
                    direction="in"
                    className="flex items-center gap-2 rounded-field px-2 py-2 text-base hover:bg-base-300 md:text-sm"
                  >
                    {row}
                  </SlideLink>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex items-center gap-2">
          <span className="flex-1" />
          <button
            type="button"
            className="btn btn-square btn-ghost md:btn-sm"
            aria-label="Close"
            title="Close"
            onClick={() => dismiss()}
          >
            <XMarkIcon className="size-6 md:size-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}
