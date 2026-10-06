import type { ReactElement } from "react";

interface Props {
  onClear: () => void;
}

export function NoMatches({ onClear }: Props): ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm">
      <p className="opacity-70">No books match your search and filters.</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}
