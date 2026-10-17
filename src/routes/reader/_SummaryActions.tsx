import type { ReactElement } from "react";

const text = "text-base md:text-sm";
const button = "btn md:btn-sm";

export function SummaryActions({
  error,
  onRetry,
  hasProvider,
  isRunning,
  onStop,
  action,
  onStart,
  row,
  spinner,
}: {
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hasProvider: boolean;
  readonly isRunning: boolean;
  readonly onStop: () => void;
  readonly action: string | null;
  readonly onStart: () => void;
  readonly row: string;
  readonly spinner: ReactElement;
}): ReactElement {
  if (error !== null) {
    return (
      <p className={`mt-2 flex items-center gap-3 text-error ${text}`}>
        {error}
        <button type="button" className={`${button} btn-ghost`} onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }

  if (!hasProvider) {
    return <p className={`mt-3 opacity-70 ${text}`}>No provider · set in Library Settings</p>;
  }

  if (isRunning) {
    return (
      <div className={`mt-3 flex items-center justify-between gap-3 ${text}`}>
        <span className="flex items-center gap-2">
          {spinner}
          {row}
        </span>
        <button type="button" className={`${button} btn-ghost`} onClick={onStop}>
          Stop
        </button>
      </div>
    );
  }

  if (action === null) return <></>;

  return (
    <button type="button" className={`${button} mt-3 w-full btn-primary`} onClick={onStart}>
      {action}
    </button>
  );
}
