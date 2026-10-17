import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { Series } from "@/domain/book";
import { FigureJobs } from "@/services/figure-jobs";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";
import { removeBook } from "@/use-cases/remove-book";
import { bookStore } from "../_support/book-store";

describe("removeBook", () => {
  it("given a book in a stored series, removes its id from every series list", async () => {
    const stored = new Series({
      id: "the tide cycle",
      name: "The Tide Cycle",
      books: [{ id: "b1" }, { id: "b2" }],
      possible: [{ id: "b1" }, { id: "b3" }],
      removed: ["b1", "b4"],
    });
    const state: {
      series: Array<Series>;
      bookRemoved: boolean;
      stopped: Array<string>;
      figuresStopped: Array<string>;
      summariesRemoved: Array<string>;
      grouped: ReadonlyArray<string>;
    } = {
      series: [stored],
      bookRemoved: false,
      stopped: [],
      figuresStopped: [],
      summariesRemoved: [],
      grouped: ["b1", "b2"],
    };
    const books = bookStore({
      listSeries: () => Effect.succeed(state.series),
      putSeries: (series) =>
        Effect.sync(() => {
          state.series = state.series.map((storedSeries) =>
            storedSeries.id === series.id ? series : storedSeries,
          );
        }),
      remove: () =>
        Effect.sync(() => {
          state.bookRemoved = true;
        }),
    });
    const jobs = Layer.succeed(
      SummaryJobs,
      SummaryJobs.of({
        state: () => Stream.empty,
        start: () => Effect.void,
        startSeries: () => Effect.void,
        startRebuild: () => Effect.void,
        stop: (id) => Effect.sync(() => state.stopped.push(id)),
        stopAll: () => Effect.die("not used"),
      }),
    );
    const summaries = Layer.succeed(
      SummaryStore,
      SummaryStore.of({
        get: () => Effect.succeed(null),
        update: (_id, change) => Effect.succeed(change(null)),
        remove: (id) => Effect.sync(() => state.summariesRemoved.push(id)),
        watch: () => Stream.empty,
      }),
    );
    const figures = Layer.succeed(
      FigureJobs,
      FigureJobs.of({
        hold: () => Effect.die("not used"),
        release: () => Effect.die("not used"),
        stop: (id) => Effect.sync(() => state.figuresStopped.push(id)),
      }),
    );
    const settings = Layer.succeed(
      SettingsStore,
      SettingsStore.of({
        changes: () => Stream.empty,
        update: () => Effect.die("not used"),
        aiChanges: () => Stream.empty,
        ai: () => Effect.die("not used"),
        putAi: () => Effect.die("not used"),
        groupedBooks: () => Effect.sync(() => state.grouped),
        putGroupedBooks: (ids) =>
          Effect.sync(() => {
            state.grouped = ids;
          }),
        usageChanges: () => Stream.empty,
        addUsage: () => Effect.die("not used"),
        resetUsage: () => Effect.die("not used"),
      }),
    );
    const layer = Layer.mergeAll(books, jobs, summaries, figures, settings);

    await Effect.runPromise(removeBook("b1").pipe(Effect.provide(layer)));

    expect(state.series[0]?.books).toEqual([{ id: "b2" }]);
    expect(state.series[0]?.possible).toEqual([{ id: "b3" }]);
    expect(state.series[0]?.removed).toEqual(["b4"]);
    expect(state.stopped).toEqual(["b1"]);
    expect(state.figuresStopped).toEqual(["b1"]);
    expect(state.bookRemoved).toBe(true);
    expect(state.summariesRemoved).toEqual(["b1"]);
    expect(state.grouped).toEqual(["b2"]);
  });
});
