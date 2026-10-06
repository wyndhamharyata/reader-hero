import type { ReactElement } from "react";
import type { ParseProgress } from "@/use-cases/extract";

interface Props {
  progress: ParseProgress | null;
  onCancel?: () => void;
}

// Not a blocking overlay: a large import takes minutes, and finished books stay usable meanwhile.
export function ProgressPanel({ progress, onCancel }: Props): ReactElement {
  const file = progress?.file;
  const title =
    file !== undefined && file.count > 1 ? `Adding ${file.index} of ${file.count}` : "Working…";
  const pages = progress === null ? "Preparing…" : `Page ${progress.page} of ${progress.total}`;
  const detail = file === undefined ? pages : `${file.name} · ${pages}`;

  return (
    <div className="fixed inset-x-4 bottom-[calc(var(--safe-bottom)+11rem)] z-40 md:inset-x-auto md:bottom-6 md:left-1/2 md:w-96 md:-translate-x-1/2">
      <div className="card border border-base-300 bg-base-100 shadow-lg">
        <div className="card-body gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="loading loading-sm loading-spinner" />
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
            {onCancel !== undefined && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
          <p className="truncate text-xs opacity-70">{detail}</p>
          <progress
            className="progress w-full progress-primary"
            value={progress?.page ?? 0}
            max={progress?.total ?? 1}
          />
        </div>
      </div>
    </div>
  );
}
