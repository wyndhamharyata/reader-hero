import type { ReactElement } from "react";
import type { Grouping } from "./_use-series-grouping";

export function GroupingStatus({
  grouping,
  onRetry,
  onReset,
}: {
  readonly grouping: Grouping;
  readonly onRetry: () => void;
  readonly onReset: () => void;
}): ReactElement | null {
  if (grouping === null) return null;

  if ("error" in grouping) {
    return (
      <div className="row-item">
        <span className="row-label text-(--red)">{grouping.error}</span>
        <button type="button" className="key small" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if ("left" in grouping) {
    return (
      <div className="row-item">
        <span className="row-label">Grouping</span>
        <span className="value">
          {grouping.left} {grouping.left === 1 ? "book" : "books"} left
        </span>
      </div>
    );
  }

  return (
    <div className="row-item">
      <span className="row-label">Grouped</span>
      <span className="value">
        {grouping.books} {grouping.books === 1 ? "book" : "books"} · {grouping.series} series
      </span>
      <button type="button" className="key small" onClick={onReset}>
        Reset
      </button>
    </div>
  );
}
