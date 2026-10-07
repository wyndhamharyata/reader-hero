import type { ReactElement } from "react";
import { ChevronDownIcon, SparklesIcon } from "@/components/icons";
import { providerLabels, type AiSettings, type BookKind } from "@/domain/ai";

export interface AiPanelProps {
  settings: AiSettings | null;
  kind: BookKind;
  guessed: boolean;
  // When the current pages already have a stored recap, so the row says so.
  recapAt: number | null;
  // The Summary row's text, "none" or "chapters 1–5 · 2 behind", and whether its job runs.
  summary: string;
  summaryRunning: boolean;
  onKind: (kind: BookKind) => void;
  onRecap: () => void;
  onSummary: () => void;
  onStopSummary: () => void;
}

interface Props extends AiPanelProps {
  open: boolean;
  onToggle: () => void;
}

// The panel sits on base-200, so unchosen buttons lift to base-100; the chosen one is neutral.
const choice = (chosen: boolean): string =>
  chosen ? "btn btn-neutral btn-sm" : "btn bg-base-100 btn-sm";

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// The per-book AI section of the menu sheet, drawn like Text settings: a header with a chevron, and
// a body that opens upward on phones. Nothing here sets the provider; that is the Settings sheet.
export function AiPanel({
  settings,
  kind,
  guessed,
  recapAt,
  summary,
  summaryRunning,
  onKind,
  onRecap,
  onSummary,
  onStopSummary,
  open,
  onToggle,
}: Props): ReactElement {
  const chevronTurn = open ? "md:rotate-180" : "max-md:rotate-180";
  const status =
    settings === null ? "No provider" : `${providerLabels[settings.provider]} · ${settings.model}`;

  return (
    <section className="mt-3 flex shrink-0 flex-col-reverse rounded-box bg-base-200 md:order-3 md:flex-col">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-4 text-base font-medium md:p-3 md:text-sm"
        aria-expanded={open}
        onClick={onToggle}
      >
        <SparklesIcon className="size-6 md:size-4" />
        <span className="flex-1 text-left">AI</span>
        <ChevronDownIcon className={`size-6 transition-transform md:size-4 ${chevronTurn}`} />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="max-h-[40dvh] overflow-y-auto overscroll-contain px-3 pt-3 md:max-h-[60dvh] md:pt-0 md:pb-3">
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-base md:text-sm">
                Kind {guessed && <span className="text-xs opacity-60">guessed</span>}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={choice(kind === "story")}
                  aria-pressed={kind === "story"}
                  onClick={() => onKind("story")}
                >
                  Story
                </button>
                <button
                  type="button"
                  className={choice(kind === "reference")}
                  aria-pressed={kind === "reference"}
                  onClick={() => onKind("reference")}
                >
                  Reference
                </button>
              </div>
            </div>

            <button
              type="button"
              className="mt-2 flex w-full items-center justify-between gap-3 border-t border-base-300 py-3 text-left text-base disabled:opacity-50 md:py-2 md:text-sm"
              disabled={settings === null}
              onClick={onRecap}
            >
              <span>
                Recap{" "}
                {recapAt !== null && <span className="text-xs opacity-60">{ago(recapAt)}</span>}
              </span>
              <span className="opacity-60">›</span>
            </button>

            <div className="flex items-center gap-2 border-t border-base-300">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left text-base disabled:opacity-50 md:py-2 md:text-sm"
                disabled={settings === null}
                onClick={onSummary}
              >
                <span className="min-w-0 truncate">
                  Summary <span className="text-xs opacity-60">{summary}</span>
                </span>
                {!summaryRunning && <span className="opacity-60">›</span>}
              </button>
              {summaryRunning && (
                <button type="button" className="btn btn-ghost btn-xs" onClick={onStopSummary}>
                  Stop
                </button>
              )}
            </div>

            <p className="border-t border-base-300 pt-2 pb-1 text-xs opacity-60">{status}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
