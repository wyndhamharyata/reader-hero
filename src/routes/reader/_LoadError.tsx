import { SlideLink } from "@/components/SlideLink";
import type { ReactElement } from "react";
import type {
  BookNotFound,
  ParsedMissing,
  StorageFailure,
  UnexpectedFailure,
} from "@/domain/errors";
import { describeError } from "@/lib/describe-error";

interface Props {
  error: BookNotFound | ParsedMissing | StorageFailure | UnexpectedFailure;
  title: string;
  onRebuild: () => void;
}

export function LoadError({ error, title, onRebuild }: Props): ReactElement {
  const canRebuild = error._tag === "ParsedMissing";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="opacity-80">{describeError(error, title)}</p>
      {canRebuild && (
        <button type="button" className="btn btn-primary" onClick={onRebuild}>
          Rebuild reader view
        </button>
      )}
      <SlideLink to="/" direction="out" className="btn btn-ghost btn-sm">
        Back to library
      </SlideLink>
    </div>
  );
}
