import { Effect, Semaphore, Stream } from "effect";
import { BookMeta, ParsedBook, type PageImage } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { log } from "@/lib/log";
import { scanCodecs } from "@/lib/pdf/codecs";
import { assembleBook } from "@/lib/pdf/assemble";
import { timed } from "@/lib/perf";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;

export function renderFigures(
  bookId: string,
): Effect.Effect<void, never, BookStore | PdfClient | FigureSlots> {
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

      // Resume after the last fully stored page, so a restarted job keeps the figures already shown.
      const existing = yield* store
        .getParsed(bookId)
        .pipe(Effect.catchTag("ParsedMissing", () => Effect.succeed(null)));
      const resumeFrom = existing?.figuresThrough ?? 0;
      const stored = resumeFrom === 0 ? [] : yield* store.listImages(bookId);

      yield* log("figures.start", `${bookId} from p${resumeFrom + 1}`);
      const parsed = yield* Effect.gen(function* () {
        const total = pdf.pageCount(handle);

        const texts = yield* Stream.range(1, total).pipe(
          Stream.mapEffect(
            (page) => timed("figures.text", pdf.readPage(handle, page), () => `p${page}`),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runCollect,
        );

        const outline = yield* pdf
          .readOutline(handle)
          .pipe(Effect.catchTag("PdfFailure", () => Effect.succeed([])));

        const pagesByPage = new Map<
          number,
          { text: (typeof texts)[number]; images: ReadonlyArray<PageImage> }
        >();
        for (const text of texts) pagesByPage.set(text.page, { text, images: [] });
        for (const { id, image } of stored) {
          const page = Number(id.split("-")[0]);
          const entry = pagesByPage.get(page);
          if (!(page <= resumeFrom) || entry === undefined) continue;
          if (image.x === undefined || image.y === undefined) continue;
          const restored = { ...image, id, page, x: image.x, y: image.y };
          pagesByPage.set(page, { text: entry.text, images: [...entry.images, restored] });
        }

        let through = resumeFrom;
        let publishedThrough = resumeFrom;
        let published = 0;
        const done = new Set<number>();
        const assemble = () =>
          new ParsedBook({
            ...assembleBook([...pagesByPage.values()], outline),
            figuresThrough: through,
          });

        // Text plus any resumed figures first, so the reader has content immediately.
        yield* store.putParsed(bookId, assemble());

        // Pages without figures still publish every 25 pages, so the resume point keeps moving.
        yield* Stream.range(resumeFrom + 1, total).pipe(
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
                done.add(page);
                while (done.has(through + 1)) through += 1;
                if (images.length > 0 || through - publishedThrough >= 25) {
                  yield* store.putParsed(bookId, assemble());
                  publishedThrough = through;
                  published += 1;
                }
                yield* log(
                  "figures.page",
                  `p${page}:${images.length}`,
                  performance.now() - pageStarted,
                );
              }),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runDrain,
        );

        yield* log("figures.assembled", `${published} partial updates`);
        return assemble();
      }).pipe(Effect.ensuring(pdf.release(handle)));

      yield* store.putParsed(bookId, parsed);
      const imageCount = parsed.blocks.filter((block) => block.kind === "image").length;
      const latest = yield* store.get(bookId);
      const figures = imageCount > 0 ? "ready" : "none";
      yield* store.putMeta(new BookMeta({ ...latest, figures }));
      yield* log("figures.total", `${imageCount} images`, performance.now() - started);
    });

    return Effect.flatMap(FigureSlots, (slots) =>
      job.pipe(
        Semaphore.withPermit(slots),
        Effect.catchTags({
          BookNotFound: () => Effect.void,
          PdfFailure: (error) => log("figures.failed", `${error.reason}; job stays pending`),
          StorageFailure: (error) => log("figures.failed", `${error.operation}; job stays pending`),
        }),
      ),
    );
  });
}
