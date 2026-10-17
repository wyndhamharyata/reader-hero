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
  // The parts make one panel, so only outer sides have borders and outer corners round.
  const isFirst = index % columns === 0 || index === start;
  const isLast = index % columns === columns - 1 || index === end;
  const isAbove = index - columns >= start;
  const isBelow = index + columns <= end;
  const colour = `oklch(var(--tray) ${flags.hue})`;

  return (
    <span
      aria-hidden="true"
      data-tray
      className={trayClasses(isFirst, isLast, isAbove, isBelow)}
      style={{
        bottom: trayBottom(isBelow, flags.rowGap),
        borderColor: colour,
        // Mixed with the page, not alpha, so no darker line shows where two parts meet.
        backgroundColor: `color-mix(in oklab, ${colour} 40%, var(--color-base-100))`,
      }}
    >
      {/* Where the next book's part ends this row, the border goes on down the row gap to the row under. */}
      {isBelow && !isLast && index + 1 + columns > end && (
        <span
          className="absolute right-0 bottom-0 w-0.5"
          style={{ height: `calc(${flags.rowGap} - 0.75rem + 2px)`, backgroundColor: colour }}
        />
      )}
    </span>
  );
}

function trayClasses(
  isFirst: boolean,
  isLast: boolean,
  isAbove: boolean,
  isBelow: boolean,
): string {
  return [
    "pointer-events-none absolute -inset-x-1.5 -top-1.5 z-0",
    isFirst ? "border-l-2" : "",
    isLast ? "border-r-2" : "",
    isAbove ? "" : "border-t-2",
    isBelow ? "" : "border-b-2",
    isFirst && !isAbove ? "rounded-tl-box" : "",
    isLast && !isAbove ? "rounded-tr-box" : "",
    isFirst && !isBelow ? "rounded-bl-box" : "",
    isLast && !isBelow ? "rounded-br-box" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");
}

function trayBottom(isBelow: boolean, rowGap: string): string {
  return isBelow ? `calc(0.375rem - ${rowGap})` : "-0.375rem";
}
