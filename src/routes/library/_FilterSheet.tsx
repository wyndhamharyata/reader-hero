import { useRef, type ReactElement } from "react";
import type { FilterGroup, Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { FilterChip } from "./_FilterChip";

interface Props {
  open: boolean;
  shelf: Shelf;
  onToggle: (group: FilterGroup, value: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const titles: Record<FilterGroup, string> = {
  status: "Reading status",
  series: "Series",
  length: "Length",
  author: "Author",
};

// Phone-only: the chip row scrolls sideways and hides most chips; this shows every group at once.
export function FilterSheet({
  open,
  shelf,
  onToggle,
  onClear,
  onClose,
}: Props): ReactElement | null {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(open, sheetRef, backdropRef, onClose);

  if (!open) return null;

  const count = shelf.cards.length;
  const showLabel = `Show ${count} ${count === 1 ? "book" : "books"}`;
  const groups = shelf.chips.filter((group) => group.chips.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 motion-safe:animate-fade-in"
        aria-label="Close filters"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Filters"
        className="relative z-10 flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300" />
        <h2 className="text-lg font-semibold">Filters</h2>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {groups.map(({ group, chips }) => (
            <section key={group} className="mb-4">
              <h3 className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">
                {titles[group]}
              </h3>
              <div className="flex flex-wrap gap-2">
                {chips.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    count={option.count}
                    active={option.active}
                    onClick={() => onToggle(group, option.value)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClear}
            disabled={!shelf.filtered}
          >
            Clear all
          </button>
          <button type="button" className="btn flex-1 btn-primary" onClick={() => dismiss()}>
            {showLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}
