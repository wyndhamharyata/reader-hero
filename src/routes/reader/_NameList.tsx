import type { ReactElement } from "react";
import type { Summary } from "@/domain/ai";

export interface NameEntry {
  readonly name: string;
  readonly note: string;
}

// Only names up to the position, so the list gives nothing away. A dot marks a name the next update will write.
export function NameList({
  names,
  summary,
  namesLabel,
  onEdit,
}: {
  readonly names: ReadonlyArray<NameEntry>;
  readonly summary: Summary | null;
  readonly namesLabel: string;
  readonly onEdit: (entry: NameEntry) => void;
}): ReactElement {
  const waiting = summary?.required ?? [];

  if (names.length === 0 && waiting.length === 0) {
    return <p className="font-sans text-(--ink-soft)">No {namesLabel.toLowerCase()} yet</p>;
  }

  return (
    <ul className="font-sans">
      {names.map((entry) => (
        <li key={entry.name} className="border-t border-(--line) first:border-t-0">
          <button
            type="button"
            className="flex w-full items-start gap-3 px-1 py-3.5 text-left"
            onClick={() => onEdit(entry)}
          >
            <span className="flex-1">
              <b className="mb-0.5 block text-[15px]">{entry.name}</b>
              {entry.note}
            </span>
            <span className="text-(--ink-soft)" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      ))}
      {waiting.map((name) => (
        <li
          key={`waiting:${name}`}
          className="border-t border-(--line) px-1 py-3.5 first:border-t-0"
        >
          <b className="text-[15px] after:ml-2 after:inline-block after:size-2 after:rounded-full after:bg-[oklch(70%_0.14_70)] after:align-middle">
            {name}
          </b>
        </li>
      ))}
    </ul>
  );
}
