import { useRef, useState, type ReactElement } from "react";
import {
  AdjustmentsIcon,
  BookOpenIcon,
  ChevronDownIcon,
  DocumentTextIcon,
} from "@/components/icons";
import type { ReaderSettings, TocEntry } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { TextSettings } from "./_TextSettings";

interface Props {
  open: boolean;
  toc: ReadonlyArray<TocEntry>;
  modeLabel: string;
  settings: ReaderSettings;
  // The Summary row's text, "none" or "chapters 1–5 · 2 behind", and whether its job runs.
  summary: string;
  summaryRunning: boolean;
  onSummary: () => void;
  onStopSummary: () => void;
  // One-line summaries by the block index of their contents entry; empty when the toggle is off.
  lines: ReadonlyMap<number, string>;
  onSelect: (blockIndex: number) => void;
  onLine: (blockIndex: number) => void;
  onToggleMode?: () => void;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}

export function MenuSheet({
  open,
  toc,
  modeLabel,
  settings,
  summary,
  summaryRunning,
  onSummary,
  onStopSummary,
  lines,
  onSelect,
  onLine,
  onToggleMode,
  onSettingsChange,
  onClose,
}: Props): ReactElement | null {
  // Text settings starts open in the desktop sidebar and collapsed on phones.
  const [textOpen, setTextOpen] = useState(() => window.matchMedia("(width >= 48rem)").matches);
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(open, sheetRef, backdropRef, onClose);

  if (!open) return null;

  // The desktop sidebar stays open behind the summary; a phone's bottom sheet makes way for it.
  const keepOpen = (then: () => void): void => {
    if (window.matchMedia("(width >= 48rem)").matches) then();
    else dismiss(then);
  };

  // The panel opens upward on phones (sheet anchored at the bottom), so the chevron flips there.
  const chevronTurn = textOpen ? "md:rotate-180" : "max-md:rotate-180";

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:flex-row">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.25rem)] shadow-2xl motion-safe:animate-sheet-up md:mx-0 md:h-full md:max-h-none md:w-80 md:max-w-[85%] md:rounded-none md:pt-[max(1rem,var(--safe-top))] md:pb-[var(--safe-bottom)] md:motion-safe:animate-slide-in"
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
          <ul className="mt-1 flex min-h-0 w-full flex-1 flex-col divide-y divide-base-300 overflow-y-auto overscroll-contain">
            {toc.length === 0 && (
              <li className="p-2 text-sm opacity-70">No table of contents found.</li>
            )}
            {toc.map((entry, index) => (
              <li key={index} className="w-full shrink-0">
                <button
                  type="button"
                  className="my-1 w-full rounded-field px-2 py-3 text-left text-base whitespace-normal hover:bg-base-300 md:py-2 md:text-sm"
                  onClick={() => dismiss(() => onSelect(entry.blockIndex))}
                >
                  {entry.title}
                </button>
                {lines.get(entry.blockIndex) !== undefined && (
                  <button
                    type="button"
                    className="mb-1 w-full rounded-field px-2 pb-2 text-left text-base opacity-70 hover:bg-base-300 md:text-sm"
                    onClick={() => keepOpen(() => onLine(entry.blockIndex))}
                  >
                    <span className="line-clamp-2 block">{lines.get(entry.blockIndex)}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <section className="mt-4 flex shrink-0 flex-col-reverse rounded-box bg-base-300 md:order-3 md:mt-3 md:flex-col">
          <button
            type="button"
            className="flex w-full items-center gap-2 p-4 text-base font-medium md:p-3 md:text-sm"
            aria-expanded={textOpen}
            onClick={() => setTextOpen(!textOpen)}
          >
            <AdjustmentsIcon className="size-6 md:size-4" />
            <span className="flex-1 text-left">Text settings</span>
            <ChevronDownIcon className={`size-6 transition-transform md:size-4 ${chevronTurn}`} />
          </button>

          {/* Rows animate between 0fr and 1fr, so the panel grows to its own height. */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${textOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            inert={!textOpen}
          >
            <div className="min-h-0 overflow-hidden">
              {/* Capped so the open panel never pushes the buttons below it off the sheet. */}
              <div className="max-h-[40dvh] overflow-y-auto overscroll-contain md:max-h-[60dvh]">
                <TextSettings settings={settings} onChange={onSettingsChange} />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-3 flex shrink-0 items-center rounded-box bg-base-300 md:order-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 p-4 text-base font-medium md:p-3 md:text-sm"
            onClick={() => keepOpen(onSummary)}
          >
            <DocumentTextIcon className="size-6 md:size-4" />
            <span className="shrink-0 text-left">Summary</span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-normal opacity-60 md:text-xs">
              {summary}
            </span>
            {!summaryRunning && <span className="opacity-60">›</span>}
          </button>
          {summaryRunning && (
            <button type="button" className="btn mr-2 btn-ghost md:btn-sm" onClick={onStopSummary}>
              Stop
            </button>
          )}
        </section>

        <div className="mt-3 flex gap-2 md:order-2 md:mt-2">
          {onToggleMode !== undefined && (
            <button
              type="button"
              className="btn flex-1 btn-lg md:justify-start md:btn-ghost md:btn-md"
              onClick={onToggleMode}
            >
              <BookOpenIcon className="size-6 md:size-4" />
              {modeLabel}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-lg md:hidden"
            onClick={() => dismiss()}
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
