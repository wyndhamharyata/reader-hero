import type { ReactElement } from "react";
import { useBookImage } from "@/lib/hooks";

interface Props {
  bookId: string;
  imageId: string;
  ratio?: number;
}

export function ReaderImage({ bookId, imageId, ratio }: Props): ReactElement {
  const image = useBookImage(bookId, imageId);
  const aspect = ratio ?? image.ratio ?? undefined;

  if (image.url === null) {
    return (
      <div
        className={`my-6 w-full animate-pulse rounded-box bg-base-200 ${aspect === undefined ? "h-40" : ""}`}
        style={{ aspectRatio: aspect }}
        // An opening book waits for this mark to go from its first screen.
        data-pending={!image.read || undefined}
      />
    );
  }

  return (
    <img
      src={image.url}
      alt=""
      loading="lazy"
      decoding="async"
      className="mx-auto my-6 block h-auto w-full rounded-box bg-white"
      style={{ aspectRatio: aspect }}
    />
  );
}
