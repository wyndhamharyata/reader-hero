import type { ReactElement } from "react";
import { ListBulletIcon, Squares2x2Icon } from "@/components/icons";
import type { LibraryView } from "@/domain/book";

interface Props {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
}

export function ViewToggle({ view, onChange }: Props): ReactElement {
  const grid = view === "grid";
  const listClass = grid ? "btn-ghost" : "btn-active";
  const gridClass = grid ? "btn-active" : "btn-ghost";

  return (
    <div className="join">
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${listClass}`}
        aria-label="List view"
        aria-pressed={!grid}
        onClick={() => onChange("list")}
      >
        <ListBulletIcon className="size-5 md:size-4" />
      </button>
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${gridClass}`}
        aria-label="Grid view"
        aria-pressed={grid}
        onClick={() => onChange("grid")}
      >
        <Squares2x2Icon className="size-5 md:size-4" />
      </button>
    </div>
  );
}
