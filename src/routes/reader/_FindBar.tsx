import { useEffect, type ReactElement } from "react";
import { ChevronDownIcon, XMarkIcon } from "@/components/icons";

// In place of the top bar while a search is open: the words, where in the matches, and the way to the next.
export function FindBar({
  query,
  count,
  hasMatches,
  onStep,
  onClose,
}: {
  readonly query: string;
  readonly count: string;
  readonly hasMatches: boolean;
  readonly onStep: (by: 1 | -1) => void;
  readonly onClose: () => void;
}): ReactElement {
  // Enter and Shift+Enter step, as a browser's find does. Escape closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const isOnButton = (event.target as Element | null)?.closest("button") !== null;

      if (event.key === "Escape") onClose();
      if (event.key === "Enter" && !isOnButton) onStep(event.shiftKey ? -1 : 1);
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  return (
    <div role="search" className="bar topbar rise z-40">
      <button
        type="button"
        className="key small square"
        aria-label="Close search"
        onClick={onClose}
      >
        <XMarkIcon className="icon" />
      </button>
      <span className="min-w-0 flex-1 truncate font-semibold">{query}</span>
      <span className="text-sm text-(--ink-soft) tabular-nums" aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        className="key small square"
        aria-label="Previous match"
        disabled={!hasMatches}
        onClick={() => onStep(-1)}
      >
        <ChevronDownIcon className="icon rotate-180" />
      </button>
      <button
        type="button"
        className="key small square"
        aria-label="Next match"
        disabled={!hasMatches}
        onClick={() => onStep(1)}
      >
        <ChevronDownIcon className="icon" />
      </button>
    </div>
  );
}
