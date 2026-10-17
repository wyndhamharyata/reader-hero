import { Context, Effect, Fiber, Layer } from "effect";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PdfClient } from "@/services/pdf-client";
import { renderFigures } from "@/use-cases/render-figures";

// A service, not a hook, so a removal can stop a book's job and wait for it before deleting the book.
export class FigureJobs extends Context.Service<
  FigureJobs,
  {
    // A screen that shows the book holds its job, which runs while any screen holds it.
    hold(owner: object, bookId: string, startPage: number): Effect.Effect<void>;
    release(owner: object, bookId: string): Effect.Effect<void>;
    // Ends the job whoever holds it, once it has stopped writing.
    stop(bookId: string): Effect.Effect<void>;
  }
>()("reader-hero/FigureJobs") {
  static readonly layer = Layer.effect(
    FigureJobs,
    Effect.gen(function* () {
      const services = yield* Effect.context<BookStore | PdfClient | FigureSlots>();
      const owners = new Map<string, Set<object>>();
      const fibers = new Map<string, Fiber.Fiber<void>>();

      // A job that ended, done or failed, starts again on the next hold, as it did when each screen ran its own.
      const hold = (owner: object, bookId: string, startPage: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          const holding = owners.get(bookId) ?? new Set();
          holding.add(owner);
          owners.set(bookId, holding);
          if (fibers.has(bookId)) return;
          // Read in `ensuring`, which can run before forkDetach returns if the job ends at once.
          const job: { fiber?: Fiber.Fiber<void> } = {};
          job.fiber = yield* Effect.forkDetach(
            renderFigures(bookId, startPage).pipe(
              Effect.provideContext(services),
              Effect.ensuring(
                Effect.sync(() => {
                  if (fibers.get(bookId) === job.fiber) fibers.delete(bookId);
                }),
              ),
            ),
          );
          fibers.set(bookId, job.fiber);
        });

      // The job keeps a checkpoint, so the next hold resumes where this one stopped.
      const release = (owner: object, bookId: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          const holding = owners.get(bookId);
          holding?.delete(owner);
          if (holding !== undefined && holding.size > 0) return Effect.void;
          owners.delete(bookId);
          return stopFiber(bookId);
        });

      const stopFiber = (bookId: string): Effect.Effect<void> => {
        const fiber = fibers.get(bookId);
        fibers.delete(bookId);
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
      };

      const stop = (bookId: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          owners.delete(bookId);
          return stopFiber(bookId);
        });

      return FigureJobs.of({ hold, release, stop });
    }),
  );
}
