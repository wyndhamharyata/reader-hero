import type { ParseProgress } from "@/use-cases/extract";

interface Props {
  progress: ParseProgress | null;
}

function labelFor(progress: ParseProgress | null): string {
  if (progress === null) return "Preparing…";
  if (progress.phase === "images") {
    return `Rendering figures, page ${progress.page} of ${progress.total}`;
  }
  return `Reading page ${progress.page} of ${progress.total}`;
}

export function BusyOverlay({ progress }: Props) {
  const value = progress?.page ?? 0;
  const max = progress?.total ?? 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="card w-full max-w-xs bg-base-100">
        <div className="card-body items-center gap-3">
          <span className="loading loading-spinner" />
          <p className="text-sm">{labelFor(progress)}</p>
          <progress className="progress progress-primary w-full" value={value} max={max} />
        </div>
      </div>
    </div>
  );
}
