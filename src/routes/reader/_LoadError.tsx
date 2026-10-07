import { SlideLink } from "@/components/SlideLink";
import { useEffect, type ReactElement } from "react";
import type { BookNotFound, ParsedMissing, StorageFailure } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { slideReady } from "@/lib/slide-to";

interface Props {
  error: BookNotFound | ParsedMissing | StorageFailure;
  title: string;
  rebuilding: boolean;
  onRebuild: () => void;
}

export function LoadError({ error, title, rebuilding, onRebuild }: Props): ReactElement {
  const canRebuild = error._tag === "ParsedMissing";
  useEffect(() => slideReady(), []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="opacity-80">{describeError(error, title)}</p>
      {canRebuild && (
        <button type="button" className="btn btn-primary" onClick={onRebuild} disabled={rebuilding}>
          Rebuild reader view
        </button>
      )}
      <SlideLink to="/" direction="out" className="btn btn-ghost btn-sm">
        Back to library
      </SlideLink>
    </div>
  );
}
