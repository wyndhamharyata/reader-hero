import { useEffect, useRef, useState, type ReactElement } from "react";
import { forkApp, stopFiber } from "@/lib/hooks";
import { watchBookImage } from "@/use-cases/book-image";

interface Props {
  bookId: string;
  imageId: string;
}

export function ReaderImage({ bookId, imageId }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const fiber = forkApp(
      watchBookImage(bookId, imageId, (image) => {
        if (image === null) return;
        if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
        const objectUrl = URL.createObjectURL(image.blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
        setRatio(image.height === 0 ? null : image.width / image.height);
      }),
    );

    return () => {
      stopFiber(fiber);
      if (urlRef.current !== null) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [bookId, imageId]);

  const aspectRatio = ratio === null ? undefined : ratio;

  if (url === null) {
    return <div className="my-6 h-40 w-full animate-pulse rounded-box bg-base-200" />;
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="mx-auto my-6 block h-auto w-full rounded-box bg-white"
      style={{ aspectRatio }}
    />
  );
}
