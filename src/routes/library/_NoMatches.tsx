import type { ReactElement } from "react";

export function NoMatches({ onClear }: { readonly onClear: () => void }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-(--ink-soft)">No books match</p>
      <button type="button" className="key small" onClick={onClear}>
        Show all
      </button>
    </div>
  );
}
