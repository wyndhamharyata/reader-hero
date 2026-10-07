import { Context, Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";
import type { AiSettings } from "@/domain/ai";
import { describeAiFailure } from "@/lib/describe-error";
import { AiClient } from "@/services/ai-client";
import { SummaryStore } from "@/services/summary-store";
import { summariseNext, type SummaryInput, type SummaryRun } from "@/use-cases/summary";

export interface JobState {
  readonly run: SummaryRun | null;
  readonly error: string | null;
}

// The summary jobs, one fiber per book, kept here so a job outlives the reader that started it.
// Stop interrupts the request in flight; the chapters that landed stay stored.
export class SummaryJobs extends Context.Service<
  SummaryJobs,
  {
    state(bookId: string): Stream.Stream<JobState>;
    start(input: SummaryInput, settings: AiSettings): Effect.Effect<void>;
    stop(bookId: string): Effect.Effect<void>;
  }
>()("reader-hero/SummaryJobs") {
  static readonly layer = Layer.effect(
    SummaryJobs,
    Effect.gen(function* () {
      const client = yield* AiClient;
      const store = yield* SummaryStore;
      const services = Layer.mergeAll(
        Layer.succeed(AiClient, client),
        Layer.succeed(SummaryStore, store),
      );
      const states = new Map<string, SubscriptionRef.SubscriptionRef<JobState>>();
      const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>();

      const stateRef = (bookId: string) =>
        Effect.gen(function* () {
          const found = states.get(bookId);
          if (found !== undefined) return found;
          const made = yield* SubscriptionRef.make<JobState>({ run: null, error: null });
          states.set(bookId, made);
          return made;
        });

      const state = (bookId: string) =>
        Stream.unwrap(Effect.map(stateRef(bookId), SubscriptionRef.changes));

      const start = Effect.fn("SummaryJobs.start")(function* (
        input: SummaryInput,
        settings: AiSettings,
      ) {
        const bookId = input.meta.id;
        if (fibers.has(bookId)) return;
        const ref = yield* stateRef(bookId);
        yield* SubscriptionRef.set(ref, {
          run: { stage: "chapter", chapter: 0, of: 0, text: "" },
          error: null,
        });
        const job = summariseNext(input, settings, (run) =>
          SubscriptionRef.set(ref, { run, error: null }),
        ).pipe(
          Effect.provide(services),
          Effect.match({ onSuccess: () => null, onFailure: describeAiFailure }),
          Effect.flatMap((error) => SubscriptionRef.set(ref, { run: null, error })),
          Effect.onInterrupt(() => SubscriptionRef.set(ref, { run: null, error: null })),
          Effect.ensuring(Effect.sync(() => fibers.delete(bookId))),
        );
        fibers.set(bookId, yield* Effect.forkDetach(job));
      });

      const stop = (bookId: string): Effect.Effect<void> => {
        const fiber = fibers.get(bookId);
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
      };

      return SummaryJobs.of({ state, start, stop });
    }),
  );
}
