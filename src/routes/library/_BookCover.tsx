import type { ReactElement } from "react";
import { useBookImage } from "@/lib/hooks";
import { useOpening } from "@/lib/slide-to";

interface Props {
  bookId: string;
}

export function BookCover({ bookId }: Props): ReactElement {
  const { url } = useBookImage(bookId, "cover");
  // The tapped book dims at once, so the tap shows while the book prepares out of sight.
  const opening = useOpening();
  const dim =
    opening?.to === `/book/${bookId}` && opening.stage !== "pressed" ? "brightness-75" : "";

  if (url === null) {
    return <div className={`aspect-[2/3] w-full animate-pulse rounded-box bg-base-300 ${dim}`} />;
  }

  return (
    <img
      src={url}
      alt=""
      className={`aspect-[2/3] w-full rounded-box bg-white object-cover object-top shadow-sm ${dim}`}
    />
  );
}
