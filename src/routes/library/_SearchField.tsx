import type { ReactElement } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";

export function SearchField({
  value,
  isFocused = false,
  onChange,
}: {
  readonly value: string;
  readonly isFocused?: boolean;
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="field min-h-11 text-(--ink-soft) md:w-70">
      <MagnifyingGlassIcon className="icon" />
      <input
        type="search"
        className="text-(--ink)"
        placeholder="Search books"
        aria-label="Search books"
        // The phone's field opens on a tap of Search, so it takes the keyboard at once.
        autoFocus={isFocused}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
