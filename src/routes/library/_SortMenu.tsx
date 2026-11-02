import type { ReactElement } from "react";
import { ArrowsUpDownIcon, ChevronDownIcon } from "@/components/icons";
import type { LibrarySort } from "@/domain/book";

const sorts: ReadonlyArray<{ value: LibrarySort; short: string; label: string }> = [
  { value: "recent", short: "Recent", label: "Recently read" },
  { value: "added", short: "Added", label: "Recently added" },
  { value: "title", short: "Title", label: "Title A to Z" },
];

// A native select under the key, so each platform shows its own picker.
export function SortMenu({
  sort,
  onChange,
}: {
  readonly sort: LibrarySort;
  readonly onChange: (sort: LibrarySort) => void;
}): ReactElement {
  const chosen = sorts.find((entry) => entry.value === sort) ?? sorts[0];

  return (
    <label className="key small relative ml-auto md:pr-2.5">
      <ArrowsUpDownIcon className="icon md:hidden" />
      <span className="hidden md:inline">{chosen?.short}</span>
      <ChevronDownIcon className="hidden size-4 md:block" />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Sort"
        value={sort}
        onChange={(event) => onChange(event.target.value as LibrarySort)}
      >
        {sorts.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}
