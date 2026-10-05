import { Effect, Stream } from "effect";
import { useEffect, useRef, useState } from "react";
import { forkApp, runApp, stopFiber } from "@/lib/hooks";
import { BookStore } from "@/services/book-store";

interface Props {
  bookId: string;
  imageId: string;
}

export function ReaderImage({ bookId, imageId }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = () => {
      void runApp(
        Effect.flatMap(BookStore, (store) => store.getImage(bookId, imageId)).pipe(
          Effect.catchCause(() => Effect.succeed(null)),
        ),
      ).then((image) => {
        if (!active || image === null) return;
        if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
        const objectUrl = URL.createObjectURL(image.blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
        setRatio(image.height === 0 ? null : image.width / image.height);
      });
    };

    load();

    // Figures render in the background; fill this one in when it lands.
    const fiber = forkApp(
      Effect.gen(function* () {
        const store = yield* BookStore;
        yield* store.updates().pipe(
          Stream.filter(
            (update) =>
              update.kind === "image" &&
              update.bookId === bookId &&
              update.imageId === imageId,
          ),
          Stream.runForEach(() => Effect.sync(load)),
        );
      }),
    );

    return () => {
      active = false;
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
