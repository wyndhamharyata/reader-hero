import type { ReactElement } from "react";
import type { UsageTally } from "@/domain/ai";
import { formatPercent } from "@/lib/format";
import { settingsHeading } from "./_settings-shared";

export function UsagePanel({
  tally,
  onReset,
}: {
  readonly tally: UsageTally | undefined;
  readonly onReset: () => void;
}): ReactElement | null {
  if (tally === undefined || tally.input <= 0) return null;

  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

  return (
    <section className="mt-4 px-4 pb-1">
      <p className={settingsHeading}>Input cache</p>
      <div className="flex items-center justify-between gap-3 text-base md:text-sm">
        <span>
          {formatPercent(tally.hit / tally.input)} from cache · {compact.format(tally.input)} input
          ·{" "}
          <span className="opacity-70">
            {tally.requests} {tally.requests === 1 ? "request" : "requests"} since{" "}
            {new Date(tally.since).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })}
          </span>
        </span>
        <button type="button" className="btn btn-ghost md:btn-sm" onClick={onReset}>
          Reset
        </button>
      </div>
      <p className="mt-2 text-sm opacity-60 md:text-xs">
        The share of input tokens the provider read from its cache, as it reports them, for the
        provider and model above.
      </p>
    </section>
  );
}
