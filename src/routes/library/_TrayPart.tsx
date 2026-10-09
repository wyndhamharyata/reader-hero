import type { ReactElement } from "react";

export interface TrayFlags {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly columns: number;
  // The padding under each row, which the tray spans where the series goes on in the next row.
  readonly rowGap: string;
  readonly hue: number;
}

export function TrayPart({ flags }: { flags: TrayFlags | null }): ReactElement | null {
  if (flags === null) return null;
  const { index, start, end, columns } = flags;
  // The parts make one shape: a part with tray under it runs down to the next row, and only an
  // outer side has a border and only an outer corner is round.
  const first = index % columns === 0 || index === start;
  const last = index % columns === columns - 1 || index === end;
  const above = index - columns >= start;
  const below = index + columns <= end;
  const colour = `oklch(var(--tray) ${flags.hue})`;

  return (
    <span
      aria-hidden="true"
      data-tray
      className={`pointer-events-none absolute -inset-x-1.5 -top-1.5 z-0 ${first ? "border-l-2" : ""} ${last ? "border-r-2" : ""} ${above ? "" : "border-t-2"} ${below ? "" : "border-b-2"} ${first && !above ? "rounded-tl-box" : ""} ${last && !above ? "rounded-tr-box" : ""} ${first && !below ? "rounded-bl-box" : ""} ${last && !below ? "rounded-br-box" : ""}`}
      style={{
        bottom: below ? `calc(0.375rem - ${flags.rowGap})` : "-0.375rem",
        borderColor: colour,
        // Mixed with the page, not alpha, so no darker seam shows where two parts meet.
        backgroundColor: `color-mix(in oklab, ${colour} 40%, var(--color-base-100))`,
      }}
    >
      {/* Where the next book's part ends this row, the border goes on down the row gap to the row under. */}
      {below && !last && index + 1 + columns > end && (
        <span
          className="absolute right-0 bottom-0 w-0.5"
          style={{ height: `calc(${flags.rowGap} - 0.75rem + 2px)`, backgroundColor: colour }}
        />
      )}
    </span>
  );
}
