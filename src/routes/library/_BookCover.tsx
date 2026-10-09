import type { ReactElement } from "react";
import { useBookImage } from "@/lib/hooks";

interface Props {
  bookId: string;
  // A row's small thumb takes a smaller radius, or its corners eat the cover.
  rounded?: "rounded-box" | "rounded-md";
}

export function BookCover({ bookId, rounded = "rounded-box" }: Props): ReactElement {
  const { url } = useBookImage(bookId, "cover");

  if (url === null) {
    return <div className={`aspect-[2/3] w-full animate-pulse ${rounded} bg-base-300`} />;
  }

  return (
    <img
      src={url}
      alt=""
      className={`aspect-[2/3] w-full ${rounded} bg-white object-cover object-top shadow-sm`}
    />
  );
}
