import type { ReactElement } from "react";
import { ArrowsUpDownIcon } from "@/components/icons";
import type { LibrarySort } from "@/domain/book";

interface Props {
  sort: LibrarySort;
  onChange: (sort: LibrarySort) => void;
}

const sorts: ReadonlyArray<readonly [LibrarySort, string]> = [
  ["added", "Recently added"],
  ["recent", "Recently read"],
  ["title", "Title A–Z"],
];

export function SortMenu({ sort, onChange }: Props): ReactElement {
  const label = sorts.find(([value]) => value === sort)?.[1] ?? "Sort";

  // Upward from the phone bar, downward from the header; a div trigger because Safari skips focus on a tapped button.
  return (
    <div className="dropdown dropdown-top md:dropdown-end md:dropdown-bottom">
      <div
        tabIndex={0}
        role="button"
        className="btn max-lg:btn-square md:btn-sm"
        aria-label={`Sort: ${label}`}
        title={`Sort: ${label}`}
      >
        <ArrowsUpDownIcon className="size-6 md:size-4" />
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
