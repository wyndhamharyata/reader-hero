import { Effect, Stream } from "effect";
import type { ImageRecord } from "@/domain/book";
import { BookStore } from "@/services/book-store";

export function watchBookImage(
  bookId: string,
  imageId: string,
  onImage: (image: ImageRecord | null) => void,
): Effect.Effect<void, never, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const pull = store.getImage(bookId, imageId).pipe(
      Effect.catchTag("StorageFailure", () => Effect.succeed(null)),
    );

    yield* pull.pipe(Effect.flatMap((image) => Effect.sync(() => onImage(image))));

    yield* store.updates().pipe(
      Stream.filter(
        (update) =>
          update.kind === "image" && update.bookId === bookId && update.imageId === imageId,
      ),
      Stream.mapEffect(() => pull),
      Stream.mapEffect((image) => Effect.sync(() => onImage(image))),
      Stream.runDrain,
    );
  });
}
