import { Effect, Semaphore, Stream } from "effect";
import { BookMeta, ParsedBook, type PageImage } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { assembleBook } from "@/lib/pdf/assemble";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PdfClient } from "@/services/pdf-client";

const IMAGE_CONCURRENCY = 2;

export function renderFigures(
  bookId: string,
): Effect.Effect<void, never, BookStore | PdfClient | FigureSlots> {
  return Effect.suspend(() => {
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

      // Resume after the last fully stored page, so a restarted job keeps the figures already shown.
      const existing = yield* store
        .getParsed(bookId)
        .pipe(Effect.catchTag("ParsedMissing", () => Effect.succeed(null)));
      const resumeFrom = existing?.figuresThrough ?? 0;
      const stored = resumeFrom === 0 ? [] : yield* store.listImages(bookId);

      const parsed = yield* Effect.gen(function* () {
        const total = pdf.pageCount(handle);

        const texts = yield* Stream.range(1, total).pipe(
          Stream.mapEffect((page) => pdf.readPage(handle, page), {
            concurrency: IMAGE_CONCURRENCY,
          }),
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
                const images = yield* pdf.readImages(handle, page);
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
                }
              }),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runDrain,
        );

        return assemble();
      }).pipe(Effect.ensuring(pdf.release(handle)));

      yield* store.putParsed(bookId, parsed);
      const imageCount = parsed.blocks.filter((block) => block.kind === "image").length;
      const latest = yield* store.get(bookId);
      const figures = imageCount > 0 ? "ready" : "none";
      yield* store.putMeta(new BookMeta({ ...latest, figures }));
    });

    return Effect.flatMap(FigureSlots, (slots) =>
      job.pipe(
        Semaphore.withPermit(slots),
        // A failed job keeps its pending state, so the next visit retries it.
        Effect.catchTags({
          BookNotFound: () => Effect.void,
          PdfFailure: () => Effect.void,
          StorageFailure: () => Effect.void,
        }),
      ),
    );
  });
}
