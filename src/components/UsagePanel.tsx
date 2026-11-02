import type { ReactElement } from "react";
import type { UsageTally } from "@/domain/ai";
import { formatPercent } from "@/lib/format";

// The share of input tokens the provider read from its cache, as it reports them.
export function UsagePanel({
  tally,
  onReset,
}: {
  readonly tally: UsageTally | undefined;
  readonly onReset: () => void;
}): ReactElement | null {
  if (tally === undefined || tally.input <= 0) return null;

  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
  const since = new Date(tally.since).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="rows mt-4.5">
      <div className="row-item">
        <span className="row-label">
          {formatPercent(tally.hit / tally.input)} from cache
          <span className="block text-[13.5px] font-normal text-(--ink-soft)">
            {compact.format(tally.input)} input · {tally.requests}{" "}
            {tally.requests === 1 ? "request" : "requests"} since {since}
          </span>
        </span>
        <button type="button" className="key small" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
