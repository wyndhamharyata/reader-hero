import { Effect, Stream } from "effect";
import { BookMeta } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { log } from "@/lib/log";
import { assembleBook } from "@/lib/pdf/assemble";
import { timed } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;
const IMAGE_STORE_CONCURRENCY = 4;

export function renderFigures(
  bookId: string,
): Effect.Effect<void, never, BookStore | PdfClient> {
  return Effect.suspend(() => {
    const started = performance.now();
    const job = Effect.gen(function* () {
      const store = yield* BookStore;
      const pdf = yield* PdfClient;

      const meta = yield* store.get(bookId);
      if (!meta.figuresPending) return;

      const blob = yield* store.getFile(bookId);
      const data = yield* Effect.tryPromise({
        try: () => blob.arrayBuffer(),
        catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
      });
      const handle = yield* pdf.load(data);

      log("figures.start", bookId);
      const parsed = yield* Effect.gen(function* () {
        const total = pdf.pageCount(handle);
        const entries = yield* Stream.range(1, total).pipe(
          Stream.mapEffect(
            (page) =>
              Effect.gen(function* () {
                const pageStarted = performance.now();
                const text = yield* timed(
                  "figures.text",
                  pdf.readPage(handle, page),
                  () => `p${page}`,
                );
                const images = yield* timed(
                  "figures.render",
                  pdf.readImages(handle, page),
                  (value) => `p${page}:${value.length}`,
                );
                yield* Effect.forEach(
                  images,
                  (image) => store.putImage(bookId, image),
                  { concurrency: IMAGE_STORE_CONCURRENCY },
                );
                log("figures.page", `p${page}:${images.length}`, performance.now() - pageStarted);
                return { text, images };
              }),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runCollect,
        );

        const outline = yield* pdf
          .readOutline(handle)
          .pipe(Effect.catchTag("PdfFailure", () => Effect.succeed([])));
        return assembleBook(
          entries.map((entry) => ({ text: entry.text, images: entry.images })),
          outline,
        );
      }).pipe(Effect.ensuring(pdf.release(handle)));

      yield* store.putParsed(bookId, parsed);
      const images = parsed.blocks.filter((block) => block.kind === "image").length;
      const latest = yield* store.get(bookId);
      const figures = images > 0 ? "ready" : "none";
      yield* store.putMeta(new BookMeta({ ...latest, figures }));
      log(
        "figures.total",
        `${images} images in ${msSeconds(performance.now() - started)}s`,
        performance.now() - started,
      );
    });

    return job.pipe(
      Effect.catchTags({
        BookNotFound: () => Effect.void,
        PdfFailure: (error) =>
          Effect.sync(() => log("figures.failed", `${error.reason}; job stays pending`)),
        StorageFailure: (error) =>
          Effect.sync(() => log("figures.failed", `${error.operation}; job stays pending`)),
      }),
    );
  });
}

const msSeconds = (ms: number): string => (ms / 1000).toFixed(1);
