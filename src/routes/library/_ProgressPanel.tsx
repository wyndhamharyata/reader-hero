import type { ReactElement } from "react";
import type { ParseProgress } from "@/use-cases/extract";

// In the page, not over it. A large import takes minutes, and finished books stay usable meanwhile.
export function ProgressPanel({
  progress,
  onCancel,
}: {
  readonly progress: ParseProgress | null;
  readonly onCancel?: () => void;
}): ReactElement {
  const file = progress?.file;
  // Only an import can be cancelled. A rebuild runs to its end.
  const verb = onCancel === undefined ? "Rebuilding" : "Adding";
  const title =
    file !== undefined && file.count > 1 ? `${verb} ${file.index} of ${file.count}` : verb;
  const ratio = progress === null ? 0 : progress.page / Math.max(1, progress.total);

  return (
    <div className="mx-4 mb-4.5 flex items-center gap-3 rounded-[14px] border border-(--line) bg-(--surface) py-3 pr-3 pl-4 md:mx-8 md:mb-5.5 md:max-w-[560px]">
      <div className="min-w-0 flex-1 text-sm">
        <b className="block">{title}</b>
        {file !== undefined && (
          <span className="block truncate text-(--ink-soft)">{file.name}</span>
        )}
        <div className="meter stripes mt-1.5">
          <span style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </div>
      {onCancel !== undefined && (
        <button type="button" className="key small" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
