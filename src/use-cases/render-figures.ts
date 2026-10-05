import { Effect, Stream } from "effect";
import type { PageImage } from "@/domain/book";
import { BookMeta } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { log } from "@/lib/log";
import { scanCodecs } from "@/lib/pdf/codecs";
import { assembleBook } from "@/lib/pdf/assemble";
import { timed } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;

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

      yield* log("figures.file", `${(data.byteLength / 1e6).toFixed(1)}MB`);
      const codecs = yield* Effect.try({
        try: () => scanCodecs(data),
        catch: () => "scan failed",
      }).pipe(Effect.catch(() => Effect.succeed("scan failed")));
      yield* log("figures.codecs", codecs);
      const handle = yield* pdf.load(data);

      yield* log("figures.start", bookId);
      const parsed = yield* Effect.gen(function* () {
        const total = pdf.pageCount(handle);

        // Text first: a full ParsedBook (sans images) is published so the
        // reader has content immediately, instead of an empty outline.
        const texts = yield* Stream.range(1, total).pipe(
          Stream.mapEffect(
            (page) =>
              timed(
                "figures.text",
                pdf.readPage(handle, page),
                () => `p${page}`,
              ),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runCollect,
        );

        const outline = yield* pdf
          .readOutline(handle)
          .pipe(Effect.catchTag("PdfFailure", () => Effect.succeed([])));

        const pagesByPage = new Map<number, { text: (typeof texts)[number]; images: ReadonlyArray<PageImage> }>();
        for (const text of texts) pagesByPage.set(text.page, { text, images: [] });

        yield* store.putParsed(
          bookId,
          assembleBook(
            texts.map((text) => ({ text, images: [] })),
            outline,
          ),
        );

        // Images second: when a page with figures finishes, the parsed book is
        // re-assembled with whatever is done and published. Each putParsed
        // fires a `parsed` PubSub event that refreshes the reader incrementally.
        let published = 0;
        yield* Stream.range(1, total).pipe(
          Stream.mapEffect(
            (page) =>
              Effect.gen(function* () {
                const pageStarted = performance.now();
                const images = yield* timed(
                  "figures.render",
                  pdf.readImages(handle, page),
                  (value) => `p${page}:${value.length}`,
                );
                for (const image of images) {
                  yield* store.putImage(bookId, image);
                }
                const entry = pagesByPage.get(page);
                if (entry !== undefined) pagesByPage.set(page, { text: entry.text, images });
                if (images.length > 0) {
                  const assemblePages = [...pagesByPage.values()].map((entry) => ({
                    text: entry.text,
                    images: entry.images,
                  }));
                  yield* store.putParsed(bookId, assembleBook(assemblePages, outline));
                  published += 1;
                }
                yield* log("figures.page", `p${page}:${images.length}`, performance.now() - pageStarted);
              }),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runDrain,
        );

        yield* log("figures.assembled", `${published} partial updates`);
        const assembled = [...pagesByPage.values()].map((entry) => ({
          text: entry.text,
          images: entry.images,
        }));
        return assembleBook(assembled, outline);
      }).pipe(Effect.ensuring(pdf.release(handle)));

      yield* store.putParsed(bookId, parsed);
      const imageCount = parsed.blocks.filter((block) => block.kind === "image").length;
      const latest = yield* store.get(bookId);
      const figures = imageCount > 0 ? "ready" : "none";
      yield* store.putMeta(new BookMeta({ ...latest, figures }));
      yield* log("figures.total", `${imageCount} images`, performance.now() - started);
    });

    return job.pipe(
      Effect.catchTags({
        BookNotFound: () => Effect.void,
        PdfFailure: (error) => log("figures.failed", `${error.reason}; job stays pending`),
        StorageFailure: (error) => log("figures.failed", `${error.operation}; job stays pending`),
      }),
    );
  });
}

