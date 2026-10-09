import { Context, Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";
import type { AiSettings } from "@/domain/ai";
import { describeAiFailure } from "@/lib/describe-error";
import type { Shelf } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { SummaryStore } from "@/services/summary-store";
import { findBookSeries } from "@/use-cases/series";
import {
  earlierNames,
  laterVolumes,
  rebuildNames,
  summariseNext,
  summariseSeries,
  type SummaryInput,
  type SummaryRun,
} from "@/use-cases/summary";

export interface JobState {
  readonly run: SummaryRun | null;
  readonly error: string | null;
}

// A service, not a hook, so a job keeps running after the reader that started it closes.
export class SummaryJobs extends Context.Service<
  SummaryJobs,
  {
    // The key is a book's id, `series:` and a series id for its series summary, or `names` for the
    // rebuild of every later volume's character list.
    state(key: string): Stream.Stream<JobState>;
    start(input: SummaryInput, settings: AiSettings): Effect.Effect<void>;
    // The volumes before `bookId`, one request each; only a tap of Summarise starts it.
    startSeries(
      series: Shelf["series"][number],
      bookId: string,
      settings: AiSettings,
    ): Effect.Effect<void>;
    // One request per later volume of every series, first to last; only a tap starts it.
    startNames(settings: AiSettings): Effect.Effect<void>;
    stop(key: string): Effect.Effect<void>;
  }
>()("reader-hero/SummaryJobs") {
  static readonly layer = Layer.effect(
    SummaryJobs,
    Effect.gen(function* () {
      const client = yield* AiClient;
      const store = yield* SummaryStore;
      const books = yield* BookStore;
      const services = Layer.mergeAll(
        Layer.succeed(AiClient, client),
        Layer.succeed(SummaryStore, store),
        Layer.succeed(BookStore, books),
      );
      const states = new Map<string, SubscriptionRef.SubscriptionRef<JobState>>();
      const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>();
      // The series run that holds a book, so the book's own job never appends to the same record.
      const held = new Map<string, string>();

      const stateRef = (key: string): Effect.Effect<SubscriptionRef.SubscriptionRef<JobState>> =>
        Effect.gen(function* () {
          const found = states.get(key);
          if (found !== undefined) return found;
          const made = yield* SubscriptionRef.make<JobState>({ run: null, error: null });
          states.set(key, made);
          return made;
        });

      const state = (key: string): Stream.Stream<JobState> =>
        Stream.unwrap(Effect.map(stateRef(key), SubscriptionRef.changes));

      const start = Effect.fn("SummaryJobs.start")(function* (
        input: SummaryInput,
        settings: AiSettings,
      ) {
        const bookId = input.meta.id;
        if (fibers.has(bookId) || held.has(bookId)) return;
        const ref = yield* stateRef(bookId);
        yield* SubscriptionRef.set(ref, {
          run: { stage: "chapter", chapter: 0, of: 0, text: "" },
          error: null,
        });
        // A later volume's names merge carries on what its series' earlier books told of their characters.
        // Without them, on a store failure, the book's own Summary still runs.
        const job = findBookSeries(bookId).pipe(
          Effect.flatMap((series) => earlierNames(series, input, settings)),
          Effect.orElseSucceed(() => []),
          Effect.flatMap((earlier) =>
            summariseNext({ ...input, earlier }, settings, (run) =>
              SubscriptionRef.set(ref, { run, error: null }),
            ),
          ),
          Effect.provide(services),
          Effect.match({ onSuccess: () => null, onFailure: describeAiFailure }),
          Effect.flatMap((error) => SubscriptionRef.set(ref, { run: null, error })),
          Effect.onInterrupt(() => SubscriptionRef.set(ref, { run: null, error: null })),
          Effect.ensuring(Effect.sync(() => fibers.delete(bookId))),
        );
        fibers.set(bookId, yield* Effect.forkDetach(job));
      });

      const startSeries = Effect.fn("SummaryJobs.startSeries")(function* (
        series: Shelf["series"][number],
        bookId: string,
        settings: AiSettings,
      ) {
        const key = `series:${series.id}`;
        if (fibers.has(key)) return;
        const ref = yield* stateRef(key);
        const at = series.books.findIndex((card) => card.book.id === bookId);
        const earlier = series.books.slice(0, Math.max(0, at)).map((card) => card.book.id);
        // Held first, then awaited, so a volume's own job ends before this run writes its record.
        for (const id of earlier) held.set(id, key);
        const running = earlier.flatMap((id) => {
          const fiber = fibers.get(id);
          return fiber === undefined ? [] : [fiber];
        });
        yield* SubscriptionRef.set(ref, {
          run: { stage: "chapter", chapter: 0, of: 0, text: "" },
          error: null,
        });
        // The volume being written shows the run in its own Summary too, where Stop also ends it.
        let shown: string | undefined;
        const report = (run: SummaryRun): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (shown !== undefined && shown !== run.book) {
              yield* SubscriptionRef.set(yield* stateRef(shown), { run: null, error: null });
            }
            shown = run.book;
            yield* SubscriptionRef.set(ref, { run, error: null });
            if (run.book !== undefined) {
              yield* SubscriptionRef.set(yield* stateRef(run.book), { run, error: null });
            }
          });
        const job = Fiber.awaitAll(running).pipe(
          Effect.andThen(summariseSeries(series, bookId, settings, report)),
          Effect.provide(services),
          Effect.match({ onSuccess: () => null, onFailure: describeAiFailure }),
          Effect.flatMap((error) => SubscriptionRef.set(ref, { run: null, error })),
          Effect.onInterrupt(() => SubscriptionRef.set(ref, { run: null, error: null })),
          Effect.ensuring(
            Effect.gen(function* () {
              fibers.delete(key);
              for (const id of earlier) if (held.get(id) === key) held.delete(id);
              if (shown !== undefined) {
                yield* SubscriptionRef.set(yield* stateRef(shown), { run: null, error: null });
              }
            }),
          ),
        );
        fibers.set(key, yield* Effect.forkDetach(job));
      });

      const startNames = Effect.fn("SummaryJobs.startNames")(function* (settings: AiSettings) {
        const key = "names";
        if (fibers.has(key)) return;
        const ref = yield* stateRef(key);
        yield* SubscriptionRef.set(ref, {
          run: { stage: "names", chapter: 0, of: 0, text: "" },
          error: null,
        });
        const mine: Array<string> = [];
        let shown: string | undefined;
        const job = Effect.gen(function* () {
          const volumes = yield* laterVolumes();
          // Held first, then awaited, so a volume's own job ends before this one writes its list.
          for (const { card } of volumes) {
            if (held.has(card.book.id)) continue;
            held.set(card.book.id, key);
            mine.push(card.book.id);
          }
          yield* Fiber.awaitAll(
            mine.flatMap((id) => {
              const fiber = fibers.get(id);
              return fiber === undefined ? [] : [fiber];
            }),
          );
          for (const [index, { series, card }] of volumes.entries()) {
            const book = card.book.id;
            const run: SummaryRun = {
              stage: "names",
              chapter: index + 1,
              of: volumes.length,
              text: "",
              book,
            };
            // The volume's own Summary shows the run too, where Stop also ends it.
            if (shown !== undefined) {
              yield* SubscriptionRef.set(yield* stateRef(shown), { run: null, error: null });
            }
            shown = book;
            yield* SubscriptionRef.set(ref, { run, error: null });
            yield* SubscriptionRef.set(yield* stateRef(book), { run, error: null });
            yield* rebuildNames(series, card, settings);
          }
        }).pipe(
          Effect.provide(services),
          Effect.match({ onSuccess: () => null, onFailure: describeAiFailure }),
          Effect.flatMap((error) => SubscriptionRef.set(ref, { run: null, error })),
          Effect.onInterrupt(() => SubscriptionRef.set(ref, { run: null, error: null })),
          Effect.ensuring(
            Effect.gen(function* () {
              fibers.delete(key);
              for (const id of mine) if (held.get(id) === key) held.delete(id);
              if (shown !== undefined) {
                yield* SubscriptionRef.set(yield* stateRef(shown), { run: null, error: null });
              }
            }),
          ),
        );
        fibers.set(key, yield* Effect.forkDetach(job));
      });

      // A book that a series run holds stops that run.
      const stop = (key: string): Effect.Effect<void> => {
        const fiber = fibers.get(key) ?? fibers.get(held.get(key) ?? "");
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
      };

      return SummaryJobs.of({ state, start, startSeries, startNames, stop });
    }),
  );
}
