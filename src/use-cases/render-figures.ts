import { Effect, Stream } from "effect";
import { BookMeta, type PageImage } from "@/domain/book";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;

const inFlight = new Set<string>();

/**
 * Renders and stores figure pixels for a book. Runs detached from the import so
 * the book is readable first; safe to call repeatedly, since it no-ops when the
 * book has no pending figures or a job is already running.
 */
export function renderFigures(
  bookId: string,
): Effect.Effect<void, never, BookStore | PdfClient> {
  if (inFlight.has(bookId)) return Effect.void;
  inFlight.add(bookId);

  return Effect.gen(function* () {
    const store = yield* BookStore;
    const pdf = yield* PdfClient;

    const meta = yield* store.get(bookId).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (meta === null || (meta.figures ?? "none") !== "pending") return;

    const blob = yield* store
      .getFile(bookId)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (blob === null) return;

    const data = yield* Effect.tryPromise({
      try: () => blob.arrayBuffer(),
      catch: () => null,
    }).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (data === null) return;

    const handle = yield* pdf.load(data).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (handle === null) return;

    yield* Effect.gen(function* () {
      const total = pdf.pageCount(handle);
      yield* Stream.range(1, total).pipe(
        Stream.mapEffect(
          (page) =>
            pdf.readImages(handle, page).pipe(
              Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<PageImage>)),
              Effect.tap((images) =>
                Effect.forEach(images, (image) =>
                  store
                    .putImage(bookId, {
                      id: image.id,
                      blob: image.blob,
                      width: image.width,
                      height: image.height,
                    })
                    .pipe(Effect.catchCause(() => Effect.void)),
                ),
              ),
            ),
          { concurrency: IMAGE_CONCURRENCY },
        ),
        Stream.runDrain,
      );
    }).pipe(Effect.ensuring(pdf.release(handle)));

    const latest = yield* store.get(bookId).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (latest !== null) {
      yield* store
        .putMeta(new BookMeta({ ...latest, figures: "ready" }))
        .pipe(Effect.catchCause(() => Effect.void));
    }
  }).pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(bookId))));
}
