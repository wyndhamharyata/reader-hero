import { Effect, Stream } from "effect";
import { BookMeta, type ImagePlacement, type PageImage } from "@/domain/book";
import { assembleBook } from "@/lib/pdf/assemble";
import { record, timed } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;

const inFlight = new Set<string>();

/**
 * Finds and renders figure pixels in the background, then re-assembles the book
 * with image blocks and replaces the stored parse. Placement detection lives
 * here (not in `extractBook`) because `getOperatorList` decodes every image.
 *
 * Safe to call repeatedly: no-ops when the book has no pending figures or a job
 * is already running.
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

    const started = performance.now();
    const outcome = yield* Effect.gen(function* () {
      const total = pdf.pageCount(handle);
      const entries = yield* Stream.range(1, total).pipe(
        Stream.mapEffect(
          (page) =>
            Effect.gen(function* () {
              const text = yield* timed(
                "figures.text",
                pdf.readPage(handle, page),
                () => `p${page}`,
              );
              const placements = yield* timed(
                "figures.placements",
                pdf.readPlacements(handle, page),
                (value) => `p${page}:${value.length}`,
              ).pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<ImagePlacement>)));
              const images = yield* timed(
                "figures.render",
                pdf.readImages(handle, page),
                () => `p${page}`,
              ).pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<PageImage>)));

              yield* Effect.forEach(
                images,
                (image) =>
                  store
                    .putImage(bookId, {
                      id: image.id,
                      blob: image.blob,
                      width: image.width,
                      height: image.height,
                    })
                    .pipe(Effect.catchCause(() => Effect.void)),
                { concurrency: 4 },
              );

              return { text, placements };
            }),
          { concurrency: IMAGE_CONCURRENCY },
        ),
        Stream.runCollect,
      );

      const outline = yield* pdf
        .readOutline(handle)
        .pipe(Effect.catchCause(() => Effect.succeed([])));
      const parsed = assembleBook(
        entries.map((entry) => ({ text: entry.text, images: entry.placements })),
        outline,
      );
      const imageCount = entries.reduce((sum, entry) => sum + entry.placements.length, 0);
      return { parsed, imageCount };
    }).pipe(
      Effect.ensuring(pdf.release(handle)),
      Effect.catchCause(() => Effect.succeed(null)),
    );

    if (outcome === null) return;

    if (outcome.imageCount > 0) {
      yield* timed("figures.store", store.putParsed(bookId, outcome.parsed)).pipe(
        Effect.catchCause(() => Effect.void),
      );
    }

    const latest = yield* store.get(bookId).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (latest !== null) {
      yield* store
        .putMeta(new BookMeta({ ...latest, figures: outcome.imageCount > 0 ? "ready" : "none" }))
        .pipe(Effect.catchCause(() => Effect.void));
    }

    record("figures.total", performance.now() - started, `${outcome.imageCount} images`);
  }).pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(bookId))));
}
