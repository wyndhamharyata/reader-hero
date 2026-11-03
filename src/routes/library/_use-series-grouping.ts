import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import type { AiSettings } from "@/domain/ai";
import type { BookMeta } from "@/domain/book";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, runApp, stopFiber, type Job } from "@/lib/hooks";
import {
  forgetDeletedSeries,
  groupSeries,
  resetGrouping as resetSeriesGrouping,
} from "@/use-cases/group-series";

export type Grouping =
  | { readonly left: number }
  | { readonly books: number; readonly series: number }
  | { readonly error: string }
  | null;

export function useSeriesGrouping({
  isHidden,
  isBusy,
  books,
  ai,
}: {
  readonly isHidden: boolean;
  readonly isBusy: boolean;
  readonly books: ReadonlyArray<BookMeta>;
  readonly ai: AiSettings | null;
}): {
  readonly grouping: Grouping;
  readonly retry: () => void;
  readonly reset: () => void;
} {
  const [grouping, setGrouping] = useState<Grouping>(null);
  // After a failure, only Retry, a new book or new settings start the next run.
  const [groupingFailed, setGroupingFailed] = useState<{
    ai: AiSettings | null;
    books: string;
  } | null>(null);
  // Reset changes no book and no setting, so a new round starts the run after it.
  const [groupingRound, setGroupingRound] = useState(0);
  // A reset stops this run first, so it cannot write the list the reset cleared.
  const running = useRef<Job | null>(null);
  // A finished parse starts a run, but none starts during an import, so its books group together.
  const groupable = books
    .filter((book) => book.parseState !== "parsing" && book.parseState !== "pending")
    .map((book) => book.id)
    .join(" ");

  useEffect(() => {
    if (isHidden || isBusy || groupable === "" || !navigator.onLine) return;
    if (groupingFailed?.ai === ai && groupingFailed.books === groupable) return;

    const fiber = forkApp(
      groupSeries(ai, (left) => setGrouping({ left })).pipe(
        Effect.match({
          onSuccess: (totals) => setGrouping(totals),
          onFailure: (error) => {
            setGrouping({
              error:
                error._tag === "StorageFailure"
                  ? "Could not save series"
                  : describeAiFailure(error),
            });
            setGroupingFailed({ ai, books: groupable });
          },
        }),
        Effect.onInterrupt(() => Effect.sync(() => setGrouping(null))),
      ),
    );

    running.current = fiber;

    return () => {
      stopFiber(fiber);
      if (running.current === fiber) running.current = null;
    };
  }, [isHidden, isBusy, groupable, ai, groupingFailed, groupingRound]);

  return {
    grouping,
    retry: () => setGroupingFailed(null),
    reset: () => {
      setGrouping(null);

      if (running.current !== null) {
        stopFiber(running.current);
        running.current = null;
      }

      void runApp(
        (ai === null ? forgetDeletedSeries() : resetSeriesGrouping()).pipe(
          Effect.match({
            onSuccess: () => {
              setGroupingFailed(null);
              setGroupingRound((round) => round + 1);
            },
            onFailure: () => setGrouping({ error: "Could not reset series" }),
          }),
        ),
      );
    },
  };
}
