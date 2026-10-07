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
  startPage = 1,
): Effect.Effect<void, never, BookStore | PdfClient | FigureSlots> {
  return Effect.suspend(() => {
    const job = Effect.gen(function* () {
      const store = yield* BookStore;
      const pdf = yield* PdfClient;

      const meta = yield* store.get(bookId);
      if (!meta.figuresPending) return;
      // Figures are encoded in a worker with OffscreenCanvas; a browser without it reads the text only.
      if (typeof OffscreenCanvas === "undefined") {
        yield* store.putMeta(new BookMeta({ ...meta, figures: "none" }));
        return;
      }

      const blob = yield* store.getFile(bookId);
      const data = yield* Effect.tryPromise({
        try: () => blob.arrayBuffer(),
        catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
      });

      const handle = yield* pdf.load(data);

      // Finished pages keep their stored figures, so a restarted job does not do them again.
      // A book parsed by an earlier build has its resume point in the parsed record.
      const existing = yield* store
        .getParsed(bookId)
        .pipe(Effect.catchTag("ParsedMissing", () => Effect.succeed(null)));
      const done = new Set(yield* store.getFigureCheckpoint(bookId));
      for (let page = 1; page <= (existing?.figuresThrough ?? 0); page += 1) done.add(page);
      const stored = done.size === 0 ? [] : yield* store.listImages(bookId);

      const parsed = yield* Effect.gen(function* () {
        const total = pdf.pageCount(handle);

        // The parse kept each page's text, so the job does not read it again; an older book reads it now.
        const kept = yield* store.getPages(bookId);
        const texts =
          kept ??
          (yield* Stream.range(1, total).pipe(
            Stream.mapEffect((page) => pdf.readPage(handle, page), {
              concurrency: IMAGE_CONCURRENCY,
            }),
            Stream.runCollect,
          ));

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
          if (!done.has(page) || entry === undefined) continue;
          if (image.x === undefined || image.y === undefined) continue;
          const restored = { ...image, id, page, x: image.x, y: image.y };
          pagesByPage.set(page, { text: entry.text, images: [...entry.images, restored] });
        }

        // Zero, so the first page with figures publishes at once and the reader is not kept waiting.
        let publishedAt = 0;
        let unpublished = false;
        const assemble = () =>
          Effect.map(assembleBook([...pagesByPage.values()], outline), (book) => {
            let through = 0;
            while (done.has(through + 1)) through += 1;
            return new ParsedBook({ ...book, figuresThrough: through });
          });

        // A resumed job shows the figures it already stored before it looks for more.
        if (stored.length > 0) yield* store.putParsed(bookId, yield* assemble());

        // Pages nearest the reader first, so the figures about to be read land before the rest.
        const order: number[] = [];
        for (let step = 0; order.length < total; step += 1) {
          if (startPage + step <= total) order.push(startPage + step);
          if (startPage - 1 - step >= 1) order.push(startPage - 1 - step);
        }

        yield* Stream.fromIterable(order).pipe(
          Stream.filter((page) => !done.has(page)),
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
                // The finished pages are a small record of their own, so every page moves the
                // resume point without rewriting the whole book; iOS interrupts this job often.
                yield* store.putFigureCheckpoint(bookId, [...done]);
                if (images.length > 0) unpublished = true;
                // An open reader reloads the whole book on each publish, so later figures land in
                // batches at most every 2 seconds.
                if (unpublished && Date.now() - publishedAt >= 2_000) {
                  yield* store.putParsed(bookId, yield* assemble());
                  publishedAt = Date.now();
                  unpublished = false;
                }
              }),
            { concurrency: IMAGE_CONCURRENCY },
          ),
          Stream.runDrain,
        );

        return yield* assemble();
      }).pipe(Effect.ensuring(pdf.release(handle)));

      yield* store.putParsed(bookId, parsed);
      yield* store.deletePages(bookId);
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
