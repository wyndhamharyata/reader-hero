import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { Series } from "@/domain/book";
import { BookStore } from "@/services/book-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";
import { removeBook } from "@/use-cases/remove-book";

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
      summariesRemoved: Array<string>;
    } = {
      series: [stored],
      bookRemoved: false,
      stopped: [],
      summariesRemoved: [],
    };
    const bookStore = Layer.succeed(
      BookStore,
      BookStore.of({
        list: () => Effect.die("not used"),
        listSeries: () => Effect.succeed(state.series),
        getSeries: () => Effect.die("not used"),
        putSeries: (series) =>
          Effect.sync(() => {
            state.series = state.series.map((storedSeries) =>
              storedSeries.id === series.id ? series : storedSeries,
            );
          }),
        removeSeries: () => Effect.die("not used"),
        get: () => Effect.die("not used"),
        putMeta: () => Effect.die("not used"),
        putFile: () => Effect.die("not used"),
        getFile: () => Effect.die("not used"),
        putParsed: () => Effect.die("not used"),
        getParsed: () => Effect.die("not used"),
        putImage: () => Effect.die("not used"),
        updates: () => Stream.empty,
        getImage: () => Effect.die("not used"),
        listImages: () => Effect.die("not used"),
        putProgress: () => Effect.die("not used"),
        getProgress: () => Effect.die("not used"),
        getPrefs: () => Effect.die("not used"),
        putPrefs: () => Effect.die("not used"),
        getFigureCheckpoint: () => Effect.die("not used"),
        putFigureCheckpoint: () => Effect.die("not used"),
        putPages: () => Effect.die("not used"),
        getPages: () => Effect.die("not used"),
        deletePages: () => Effect.die("not used"),
        remove: () =>
          Effect.sync(() => {
            state.bookRemoved = true;
          }),
        estimate: () => Effect.succeed(null),
        requestPersistent: () => Effect.succeed(false),
        takeInbox: () => Effect.succeed([]),
      }),
    );
    const jobs = Layer.succeed(
      SummaryJobs,
      SummaryJobs.of({
        state: () => Stream.empty,
        start: () => Effect.void,
        startSeries: () => Effect.void,
        startNames: () => Effect.void,
        stop: (id) => Effect.sync(() => state.stopped.push(id)),
      }),
    );
    const summaries = Layer.succeed(
      SummaryStore,
      SummaryStore.of({
        get: () => Effect.succeed(null),
        update: (_id, change) => Effect.succeed(change(null)),
        remove: (id) => Effect.sync(() => state.summariesRemoved.push(id)),
        changes: () => Stream.empty,
      }),
    );
    const layer = Layer.mergeAll(bookStore, jobs, summaries);

    await Effect.runPromise(removeBook("b1").pipe(Effect.provide(layer)));

    expect(state.series[0]?.books).toEqual([{ id: "b2" }]);
    expect(state.series[0]?.possible).toEqual([{ id: "b3" }]);
    expect(state.series[0]?.removed).toEqual(["b4"]);
    expect(state.stopped).toEqual(["b1"]);
    expect(state.bookRemoved).toBe(true);
    expect(state.summariesRemoved).toEqual(["b1"]);
  });
});
