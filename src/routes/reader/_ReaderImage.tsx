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
        className={`my-6 w-full animate-pulse rounded-sm bg-(--sunk) ${aspect === undefined ? "h-40" : ""}`}
        style={{ aspectRatio: aspect }}
      />
    );
  }

  return (
    <img
      src={image.url}
      alt=""
      loading="lazy"
      decoding="async"
      className="mx-auto my-6 block h-auto w-full rounded-sm bg-white shadow-[0_0_0_1px_oklch(0%_0_0/0.08)] motion-safe:animate-fade-in"
      style={{ aspectRatio: aspect }}
    />
  );
}
