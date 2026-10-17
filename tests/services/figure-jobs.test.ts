import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

// The job needs OffscreenCanvas to exist. The stubbed store never lets it reach a page.
vi.stubGlobal("OffscreenCanvas", class {});
import { FigureJobs } from "@/services/figure-jobs";
import { FigureSlots } from "@/services/figure-slots";
import { PdfClient } from "@/services/pdf-client";
import { bookStore } from "../_support/book-store";

// Each job waits forever on its first read, so a test sees only starts and stops.
function harness() {
  const counts = { started: 0, stopped: 0 };
  const started = Deferred.makeUnsafe<void>();
  const store = bookStore({
    get: () =>
      Effect.sync(() => {
        counts.started += 1;
      }).pipe(
        Effect.andThen(Deferred.succeed(started, undefined)),
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            counts.stopped += 1;
          }),
        ),
      ),
  });
  const layer = FigureJobs.layer.pipe(
    Layer.provide(Layer.mergeAll(store, FigureSlots.layer, Layer.succeed(PdfClient, {} as never))),
  );
  const run = (program: Effect.Effect<void, never, FigureJobs>) =>
    Effect.runPromise(program.pipe(Effect.provide(layer)));
  return { counts, run, started };
}

describe("FigureJobs", () => {
  const library = {};
  const reader = {};

  it("given two screens holding a book, runs one job until both let go", async () => {
    const { counts, run, started } = harness();
    await run(
      Effect.gen(function* () {
        const jobs = yield* FigureJobs;
        yield* jobs.hold(library, "b1", 1);
        yield* jobs.hold(reader, "b1", 1);
        yield* Deferred.await(started);
        expect(counts).toEqual({ started: 1, stopped: 0 });
        yield* jobs.release(library, "b1");
        expect(counts.stopped).toBe(0);
        yield* jobs.release(reader, "b1");
        expect(counts.stopped).toBe(1);
      }),
    );
  });

  it("given a removal, stops the job whoever holds it", async () => {
    const { counts, run, started } = harness();
    await run(
      Effect.gen(function* () {
        const jobs = yield* FigureJobs;
        yield* jobs.hold(library, "b1", 1);
        yield* Deferred.await(started);
        yield* jobs.stop("b1");
        expect(counts).toEqual({ started: 1, stopped: 1 });
      }),
    );
  });
});
