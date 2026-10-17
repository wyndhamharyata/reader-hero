import type { ReactElement } from "react";
import type {
  BookNotFound,
  ParsedMissing,
  StorageFailure,
  UnexpectedFailure,
} from "@/domain/errors";
import { LoadError } from "./_LoadError";

interface Props {
  status: "loading" | "done" | "error";
  error: BookNotFound | ParsedMissing | StorageFailure | UnexpectedFailure | null;
  isRepairing: boolean;
  title: string;
  onRebuild: () => void;
}

// Only a slow open shows the spinner: a usual one fills in within a few frames.
export function ReaderStatus({
  status,
  error,
  isRepairing,
  title,
  onRebuild,
}: Props): ReactElement | null {
  if (status === "loading" || isRepairing) {
    return (
      <div className="flex h-full items-center justify-center motion-safe:animate-[fade-in_240ms_ease-out_400ms_both]">
        <span className="loading loading-spinner" />
      </div>
    );
  }

  if (error === null) return null;

  return <LoadError error={error} title={title} onRebuild={onRebuild} />;
}
