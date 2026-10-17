import type { ReactElement } from "react";
import type { AiSettings } from "@/domain/ai";
import { ConsentNote } from "./_ConsentNote";
import { SummaryActions } from "./_SummaryActions";
import { SummaryAskForm } from "./_SummaryAskForm";
import { SummaryControls } from "./_SummaryControls";

const text = "text-base md:text-sm";
const button = "btn md:btn-sm";

export function SummaryFooter({
  consentPending,
  settings,
  onCancelConsent,
  onAllowConsent,
  isDiscardPending,
  onKeep,
  onDiscard,
  error,
  onRetry,
  isRunning,
  onStop,
  action,
  onStart,
  row,
  spinner,
  question,
  onQuestion,
  onAsk,
  hasSummary,
  isAsking,
  onBack,
  isStory,
  onKind,
  copied,
  onDiscardClick,
  onClose,
  unit,
}: {
  readonly consentPending: "start" | "ask" | null;
  readonly settings: AiSettings | null;
  readonly onCancelConsent: () => void;
  readonly onAllowConsent: () => void;
  readonly isDiscardPending: boolean;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly isRunning: boolean;
  readonly onStop: () => void;
  readonly action: string | null;
  readonly onStart: () => void;
  readonly row: string;
  readonly spinner: ReactElement;
  readonly question: string;
  readonly onQuestion: (question: string) => void;
  readonly onAsk: () => void;
  readonly hasSummary: boolean;
  readonly isAsking: boolean;
  readonly onBack: (() => void) | undefined;
  readonly isStory: boolean;
  readonly onKind: () => void;
  readonly copied: string;
  readonly onDiscardClick: () => void;
  readonly onClose: () => void;
  readonly unit: string;
}): ReactElement {
  if (consentPending !== null && settings !== null) {
    return (
      <ConsentNote
        provider={settings.provider}
        onCancel={onCancelConsent}
        onAllow={onAllowConsent}
      />
    );
  }

  if (isDiscardPending) {
    return (
      <div className={`mt-3 flex items-center justify-between gap-3 ${text}`}>
        <span>The summary is removed. Summarising starts again from the first {unit}.</span>
        <div className="flex shrink-0 gap-2">
          <button type="button" className={`${button} btn-ghost`} onClick={onKeep}>
            Keep
          </button>
          <button type="button" className={`${button} btn-error`} onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SummaryActions
        error={error}
        onRetry={onRetry}
        hasProvider={settings !== null}
        isRunning={isRunning}
        onStop={onStop}
        action={action}
        onStart={onStart}
        row={row}
        spinner={spinner}
      />
      <SummaryAskForm
        question={question}
        onQuestion={onQuestion}
        onAsk={onAsk}
        hasProvider={settings !== null}
        hasSummary={hasSummary}
        isRunning={isRunning}
        isAsking={isAsking}
      />
      <SummaryControls
        onBack={onBack}
        isStory={isStory}
        onKind={onKind}
        copied={copied}
        hasSummary={hasSummary}
        isRunning={isRunning}
        onDiscard={onDiscardClick}
        onClose={onClose}
      />
    </>
  );
}
