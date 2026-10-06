import type { ReactElement } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function SearchField({ value, onChange }: Props): ReactElement {
  // 16px text on phones: iOS zooms the page into any focused input smaller than that.
  return (
    <label className="input w-full text-base md:w-64 md:text-sm">
      <MagnifyingGlassIcon className="size-5 opacity-50 md:size-4" />
      <input
        type="search"
        className="grow"
        placeholder="Search title, author…"
        aria-label="Search books"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
