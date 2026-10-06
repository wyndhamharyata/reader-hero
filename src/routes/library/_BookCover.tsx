import type { ReactElement } from "react";
import { useBookImage } from "@/lib/hooks";

interface Props {
  bookId: string;
}

export function BookCover({ bookId }: Props): ReactElement {
  const { url } = useBookImage(bookId, "cover");

  if (url === null) {
    return <div className="aspect-[2/3] w-full animate-pulse rounded-box bg-base-300" />;
  }

  return (
    <img
      src={url}
      alt=""
      className="aspect-[2/3] w-full rounded-box bg-white object-cover object-top shadow-sm"
    />
  );
}
