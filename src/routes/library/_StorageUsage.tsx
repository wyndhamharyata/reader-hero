import { formatSize } from "@/lib/format";
import type { StorageEstimate } from "@/services/book-store";

interface Props {
  estimate: StorageEstimate | null;
}

export function StorageUsage({ estimate }: Props) {
  return (
    <>
      {estimate !== null && estimate.quota > 0 && (
        <p className="text-center text-xs opacity-60">
          Using {formatSize(estimate.usage)} of {formatSize(estimate.quota)}
        </p>
      )}
    </>
  );
}
