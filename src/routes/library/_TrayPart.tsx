import type { ReactElement } from "react";

export interface TrayFlags {
  readonly firstOnTray: boolean;
  readonly lastOnTray: boolean;
  readonly firstColumn: boolean;
  readonly lastColumn: boolean;
  readonly columns: number;
  readonly visible: boolean;
}

export function TrayPart({ flags }: { flags: TrayFlags | null }): ReactElement | null {
  if (flags === null) return null;
  // A row break runs the tray to the screen edge; elsewhere it sits 6px outside the item.
  const left = flags.columns > 1 && flags.firstColumn && !flags.firstOnTray ? "-1rem" : "-0.375rem";
  const right = flags.columns > 1 && flags.lastColumn && !flags.lastOnTray ? "-1rem" : "-0.375rem";
  const start = flags.firstOnTray ? (flags.columns === 1 ? "rounded-t-box" : "rounded-l-box") : "";
  const end = flags.lastOnTray ? (flags.columns === 1 ? "rounded-b-box" : "rounded-r-box") : "";

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute top-[-0.375rem] bottom-[-0.375rem] z-0 bg-base-300 transition-opacity duration-150 motion-reduce:transition-none ${start} ${end}`}
      style={{ left, right, opacity: flags.visible ? 1 : 0 }}
    />
  );
}
