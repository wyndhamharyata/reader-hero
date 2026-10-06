import { useRef, useState, type ReactElement } from "react";
import { AdjustmentsIcon, BookOpenIcon, ChevronDownIcon } from "@/components/icons";
import type { ReaderSettings, TocEntry } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { TextSettings } from "./_TextSettings";

interface Props {
  open: boolean;
  toc: ReadonlyArray<TocEntry>;
  modeLabel: string | null;
  settings: ReaderSettings;
  onSelect: (blockIndex: number) => void;
  onToggleMode: () => void;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}

export function MenuSheet({
  open,
  toc,
  modeLabel,
  settings,
  onSelect,
  onToggleMode,
  onSettingsChange,
  onClose,
}: Props): ReactElement | null {
  // Collapsed on phones so the contents list gets the sheet's height; open in the desktop sidebar.
  const [textOpen, setTextOpen] = useState(() => window.matchMedia("(width >= 48rem)").matches);
  const sheetRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(open, sheetRef, listRef, backdropRef, onClose);

  if (!open) return null;

  // The panel opens upward on phones (sheet anchored at the bottom), so the chevron flips there.
  const chevronTurn = textOpen ? "md:rotate-180" : "max-md:rotate-180";

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:flex-row">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-black/40 motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        className="relative z-10 mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-box bg-base-100 p-4 pb-[calc(var(--safe-bottom)+0.25rem)] motion-safe:animate-sheet-up md:mx-0 md:h-full md:max-h-none md:w-80 md:max-w-[85%] md:rounded-none md:pt-[max(1rem,var(--safe-top))] md:pb-[var(--safe-bottom)] md:motion-safe:animate-slide-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />

        <div className="hidden items-center justify-between md:order-1 md:flex">
          <h2 className="text-lg font-semibold">Menu</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss()}>
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:order-4 md:mt-4">
          <h3 className="text-sm font-semibold">Contents</h3>
          <ul
            ref={listRef}
            className="mt-1 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            {toc.length === 0 && (
              <li className="p-2 text-sm opacity-70">No table of contents found.</li>
            )}
            {toc.map((entry, index) => (
              <li key={index} className="w-full shrink-0">
                <button
                  type="button"
                  className="w-full rounded-field px-2 py-2 text-left text-sm whitespace-normal hover:bg-base-200 md:py-1.5"
                  onClick={() => dismiss(() => onSelect(entry.blockIndex))}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <section className="mt-3 flex flex-col-reverse rounded-box border border-base-300 md:order-3 md:mt-2 md:flex-col">
          <button
            type="button"
            className="flex w-full items-center gap-2 p-3 text-sm font-medium"
            aria-expanded={textOpen}
            onClick={() => setTextOpen(!textOpen)}
          >
            <AdjustmentsIcon className="size-5 md:size-4" />
            <span className="flex-1 text-left">Text settings</span>
            <ChevronDownIcon className={`size-5 transition-transform md:size-4 ${chevronTurn}`} />
          </button>

          {textOpen && <TextSettings settings={settings} onChange={onSettingsChange} />}
        </section>

        <div className="mt-3 flex gap-2 md:order-2 md:mt-2">
          {modeLabel !== null && (
            <button
              type="button"
              className="btn flex-1 md:justify-start md:btn-ghost"
              onClick={onToggleMode}
            >
              <BookOpenIcon className="size-5 md:size-4" />
              {modeLabel}
            </button>
          )}
          <button type="button" className="btn btn-ghost md:hidden" onClick={() => dismiss()}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
