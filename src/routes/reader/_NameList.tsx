import type { ReactElement } from "react";
import { PencilIcon, PlusIcon } from "@/components/icons";
import type { Summary } from "@/domain/ai";

export function NameList({
  names,
  list,
  story,
  namesLabel,
  summary,
  onEdit,
}: {
  readonly names: ReadonlyArray<{
    readonly name: string;
    readonly note: string;
    readonly chapter: number;
  }>;
  readonly list: ReadonlyArray<{ readonly heading: string }>;
  readonly story: boolean;
  readonly namesLabel: string;
  readonly summary: Summary | null;
  readonly onEdit: (entry: { readonly name: string; readonly note: string } | null) => void;
}): ReactElement {
  return (
    <>
      {names.length === 0 && <p className="px-4 opacity-70">No {namesLabel.toLowerCase()}</p>}
      <ul className="flex flex-col">
        {names.map((entry) => (
          <li key={entry.name} className="px-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-field px-2 py-2 text-left hover:bg-base-300"
              aria-label={`Edit ${entry.name}`}
              onClick={() => onEdit({ name: entry.name, note: entry.note })}
            >
              <span>
                <span className="font-medium">{entry.name}</span>{" "}
                <span className="text-[0.75em] opacity-60">{list[entry.chapter - 1]?.heading}</span>
                <br />
                {entry.note}
              </span>
              <PencilIcon className="size-5 shrink-0 opacity-60 md:size-4" />
            </button>
          </li>
        ))}
      </ul>
      {summary !== null && (
        <div className="mt-1 px-2 pb-1 font-sans">
          <button
            type="button"
            className="btn w-full justify-start btn-ghost px-2 md:btn-sm"
            onClick={() => onEdit(null)}
          >
            <PlusIcon className="size-6 opacity-60 md:size-4" />
            {story ? "Add character" : "Add term"}
          </button>
        </div>
      )}
      {summary !== null && summary.required.length > 0 && (
        <p className="mt-2 px-4 text-[0.75em] opacity-60">Pending: {summary.required.join(", ")}</p>
      )}
    </>
  );
}
