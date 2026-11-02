import type { ReactElement } from "react";
import { PlusIcon } from "@/components/icons";

// An open book on a ledge. Dragged files lift a page and light the ledge.
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
      <div className="flex w-full flex-col items-center" aria-hidden="true">
        <div className="openbook">
          <div className="board" />
          <div className="leaf left" />
          <div className="leaf right" />
          <div className="leaf turning" />
          <div className="leaf lifting" />
          <div className="spine-ribbon" />
        </div>
        <div className="ledge" />
      </div>
      <h2 className="mt-7 font-serif text-[22px] font-bold">
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
