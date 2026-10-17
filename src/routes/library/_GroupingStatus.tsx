import type { ReactElement } from "react";
import type { Grouping } from "./_use-series-grouping";

interface Props {
  grouping: Grouping;
  onRetry: () => void;
  onReset: () => void;
}

export function GroupingStatus({ grouping, onRetry, onReset }: Props): ReactElement | null {
  if (grouping === null) return null;

  if ("error" in grouping) {
    return (
      <p className="mt-2 flex items-center gap-3 text-base text-error md:text-sm">
        {grouping.error}
        <button type="button" className="btn btn-ghost md:btn-sm" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }

  if ("left" in grouping) {
    return (
      <p className="mt-2 flex items-center gap-2 text-base md:text-sm">
        <span className="loading loading-sm loading-spinner md:loading-xs" />
        {grouping.left} {grouping.left === 1 ? "book" : "books"} left
      </p>
    );
  }

  return (
    <>
      <p className="mt-2 flex items-center justify-between gap-3 text-base md:text-sm">
        <span className="opacity-70">
          {grouping.books} {grouping.books === 1 ? "book" : "books"} · {grouping.series} series
        </span>
        <button type="button" className="btn btn-ghost md:btn-sm" onClick={onReset}>
          Reset
        </button>
      </p>
      <p className="text-sm opacity-60 md:text-xs">
        Reset sends every book again. Series that grouping made go, removed series come back, and
        saved series stay.
      </p>
    </>
  );
}
