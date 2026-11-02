import type { ReactElement } from "react";
import { PlusIcon } from "@/components/icons";

// An empty slipcase. Dragged files light its mouth and hold the pale book halfway in.
export function EmptyShelf({
  isDropping,
  isBusy,
  onAdd,
}: {
  readonly isDropping: boolean;
  readonly isBusy: boolean;
  readonly onAdd: () => void;
}): ReactElement {
  return (
    <section
      className={`flex flex-1 flex-col items-center justify-center gap-4.5 pb-15 text-center ${isDropping ? "is-dropping" : ""}`}
    >
      <div className="case" aria-hidden="true">
        <div className="shadow" />
        <div className="ghost" />
        <div className="body">
          <div className="mouth" />
        </div>
      </div>
      <h2 className="mt-2 font-serif text-[22px] font-bold">
        {isDropping ? "Drop to add" : "No books yet"}
      </h2>
      <button
        type="button"
        className="key green min-h-14 rounded-2xl px-7 text-[17px]"
        disabled={isBusy}
        onClick={onAdd}
      >
        <PlusIcon className="icon" />
        Add book
      </button>
    </section>
  );
}
