import { Fragment, type ReactElement } from "react";
import type { FilterGroup, Shelf } from "@/lib/shelf";

interface Props {
  shelf: Shelf;
  onToggle: (group: FilterGroup, value: string) => void;
  onClear: () => void;
}

const chip = "btn btn-sm shrink-0 rounded-full";
const idle = `${chip} btn-ghost border-base-300`;
const active = `${chip} btn-primary`;

export function FilterChips({ shelf, onToggle, onClear }: Props): ReactElement {
  const allClass = shelf.filtered ? idle : active;

  // touch-pan-x and overflow-y-hidden keep a sideways row from springing up and down on iOS.
  return (
    <div className="-mx-4 flex touch-pan-x [scrollbar-width:none] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 md:mx-0 md:flex-wrap md:px-0">
      <button type="button" className={allClass} aria-pressed={!shelf.filtered} onClick={onClear}>
        All <span className="opacity-70">{shelf.matching}</span>
      </button>
      {shelf.chips.map(({ group, chips }) => (
        <Fragment key={group}>
          <span className="my-1 w-px shrink-0 bg-base-300" aria-hidden="true" />
          {chips.map((option) => {
            const optionClass = option.active ? active : idle;
            return (
              <button
                key={option.value}
                type="button"
                className={optionClass}
                aria-pressed={option.active}
                onClick={() => onToggle(group, option.value)}
              >
                {option.label} <span className="opacity-70">{option.count}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
