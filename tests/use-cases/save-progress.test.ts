import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { ReadingProgress } from "@/domain/book";
import { BookStore } from "@/services/book-store";
import { saveReadingProgress, setBookFinished } from "@/use-cases/save-progress";

function harness(initial: ReadingProgress | null) {
  const state = { progress: initial };
  const layer = Layer.succeed(
    BookStore,
    BookStore.of({
      list: () => Effect.die("not used"),
      listSeries: () => Effect.die("not used"),
      getSeries: () => Effect.die("not used"),
      putSeries: () => Effect.die("not used"),
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
      putProgress: (_id, progress) =>
        Effect.sync(() => {
          state.progress = progress;
        }),
      getProgress: () => Effect.succeed(state.progress),
      getPrefs: () => Effect.die("not used"),
      putPrefs: () => Effect.die("not used"),
      getFigureCheckpoint: () => Effect.die("not used"),
      putFigureCheckpoint: () => Effect.die("not used"),
      putPages: () => Effect.die("not used"),
      getPages: () => Effect.die("not used"),
      deletePages: () => Effect.die("not used"),
      remove: () => Effect.die("not used"),
      estimate: () => Effect.succeed(null),
      requestPersistent: () => Effect.succeed(false),
      takeInbox: () => Effect.succeed([]),
    }),
  );
  return { layer, state };
}

describe("saveReadingProgress", () => {
  it("given a stored Finished choice, keeps it while saving a new position", async () => {
    const { layer, state } = harness(
      new ReadingProgress({
        blockIndex: 24,
        percent: 0.24,
        updatedAt: 5,
        furthest: 30,
        finished: true,
      }),
    );

    await Effect.runPromise(saveReadingProgress("b1", 50, 100, 30).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 50,
      percent: 0.5,
      furthest: 50,
      finished: true,
    });
  });

  it("given Finished turned off, keeps it off below 98% and clears it on crossing", async () => {
    const { layer, state } = harness(
      new ReadingProgress({
        blockIndex: 99,
        percent: 0.99,
        updatedAt: 5,
        furthest: 99,
        finished: false,
      }),
    );

    await Effect.runPromise(saveReadingProgress("b1", 95, 100, 99).pipe(Effect.provide(layer)));
    expect(state.progress?.finished).toBe(false);

    await Effect.runPromise(saveReadingProgress("b1", 98, 100, 99).pipe(Effect.provide(layer)));
    expect(state.progress?.finished).toBeUndefined();
  });
});

describe("setBookFinished", () => {
  it("given a saved position, changes Finished without moving any position fields", async () => {
    const { layer, state } = harness(
      new ReadingProgress({
        blockIndex: 24,
        percent: 0.24,
        updatedAt: 5,
        furthest: 30,
        finished: false,
      }),
    );

    await Effect.runPromise(setBookFinished("b1", true).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 24,
      percent: 0.24,
      updatedAt: 5,
      furthest: 30,
      finished: true,
    });
  });

  it("given no saved position, stores Finished without moving the book", async () => {
    const { layer, state } = harness(null);

    await Effect.runPromise(setBookFinished("b1", true).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 0,
      percent: 0,
      updatedAt: 0,
      finished: true,
    });
    expect(state.progress?.furthest).toBeUndefined();
  });
});
