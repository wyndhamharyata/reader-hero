import type { ReactElement } from "react";
import { ArrowLeftIcon, TrashIcon, XMarkIcon } from "@/components/icons";
import { CopyButton } from "./_CopyButton";

const button = "btn md:btn-sm";

export function SummaryControls({
  onBack,
  isStory,
  onKind,
  copied,
  hasSummary,
  isRunning,
  onDiscard,
  onClose,
}: {
  readonly onBack: (() => void) | undefined;
  readonly isStory: boolean;
  readonly onKind: () => void;
  readonly copied: string;
  readonly hasSummary: boolean;
  readonly isRunning: boolean;
  readonly onDiscard: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const kindLabel = isStory ? "Story" : "Document";
  const kindAria = `Book kind: ${kindLabel}`;
  const spacerClass = onBack === undefined ? "flex-1" : "hidden flex-1 md:block";

  return (
    <div className="mt-2 flex items-center gap-1 md:gap-2">
      {onBack !== undefined && (
        <button type="button" className={`${button} flex-1 px-3 md:hidden`} onClick={onBack}>
          <ArrowLeftIcon className="size-6" />
          Back
        </button>
      )}
      <button
        type="button"
        className={`${button} px-3 md:px-4`}
        aria-label={kindAria}
        disabled={isRunning}
        onClick={onKind}
      >
        {kindLabel}
      </button>
      <span className={spacerClass} />
      <CopyButton text={copied} />
      <button
        type="button"
        className={`${button} btn-square btn-ghost text-error`}
        aria-label="Discard"
        title="Discard"
        disabled={!hasSummary || isRunning}
        onClick={onDiscard}
      >
        <TrashIcon className="size-6 md:size-4" />
      </button>
      <button
        type="button"
        className={`${button} btn-square btn-ghost`}
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <XMarkIcon className="size-6 md:size-4" />
      </button>
    </div>
  );
}
