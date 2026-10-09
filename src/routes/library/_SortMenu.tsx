import type { ReactElement } from "react";
import { ArrowsUpDownIcon } from "@/components/icons";
import type { LibrarySort } from "@/domain/book";

interface Props {
  sort: LibrarySort;
  onChange: (sort: LibrarySort) => void;
}

export const sorts: ReadonlyArray<readonly [LibrarySort, string]> = [
  ["added", "Recently added"],
  ["recent", "Recently read"],
  ["title", "Title A–Z"],
];

export function SortMenu({ sort, onChange }: Props): ReactElement {
  const label = sorts.find(([value]) => value === sort)?.[1] ?? "Sort";

  // The header's only; a phone sorts in the filter sheet. A div trigger because Safari skips focus on a
  // tapped button.
  return (
    <div className="dropdown dropdown-end dropdown-bottom">
      <div
        tabIndex={0}
        role="button"
        className="btn btn-sm max-lg:btn-square"
        aria-label={`Sort: ${label}`}
        title={`Sort: ${label}`}
      >
        <ArrowsUpDownIcon className="size-4" />
        <span className="hidden lg:inline">{label}</span>
      </div>
      <ul
        tabIndex={0}
        className="menu dropdown-content z-50 w-48 rounded-box bg-base-100 p-1 shadow-lg"
      >
        {sorts.map(([value, text]) => {
          const itemClass = value === sort ? "menu-active" : "";
          return (
            <li key={value}>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onChange(value);
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              >
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
