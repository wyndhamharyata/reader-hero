import { Fragment, type ReactElement } from "react";
import type { FilterGroup, Shelf } from "@/lib/shelf";
import { FilterChip } from "./_FilterChip";

interface Props {
  shelf: Shelf;
  onToggle: (group: FilterGroup, value: string) => void;
  onClear: () => void;
}

export function FilterChips({ shelf, onToggle, onClear }: Props): ReactElement {
  // touch-pan-x and overflow-y-hidden keep a sideways row from springing up and down on iOS.
  return (
    <div className="-mx-4 flex touch-pan-x [scrollbar-width:none] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 md:mx-0 md:flex-wrap md:px-0">
      <FilterChip label="All" count={shelf.matching} active={!shelf.filtered} onClick={onClear} />
      {shelf.chips.map(({ group, chips }) => (
        <Fragment key={group}>
          <span className="my-1 w-px shrink-0 bg-base-300" aria-hidden="true" />
          {chips.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              count={option.count}
              active={option.active}
              onClick={() => onToggle(group, option.value)}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
