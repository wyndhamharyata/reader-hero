import type { ReactElement } from "react";
import { useBookImage } from "@/lib/hooks";

interface Props {
  bookId: string;
  imageId: string;
}

export function ReaderImage({ bookId, imageId }: Props): ReactElement {
  const { url, ratio } = useBookImage(bookId, imageId);

  if (url === null) {
    return <div className="my-6 h-40 w-full animate-pulse rounded-box bg-base-200" />;
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="mx-auto my-6 block h-auto w-full rounded-box bg-white"
      style={{ aspectRatio: ratio ?? undefined }}
    />
  );
}
