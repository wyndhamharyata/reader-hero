import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Block, PARSED_VERSION, ParsedBook, ReadingProgress } from "@/domain/book";
import { ParsedMissing } from "@/domain/errors";
import { saveReadingProgress, setBookFinished } from "@/use-cases/save-progress";
import { bookStore } from "../_support/book-store";

function harness(initial: ReadingProgress | null, blocks = 0) {
  const state = { progress: initial };
  const layer = bookStore({
    getParsed: (id) =>
      blocks === 0
        ? Effect.fail(new ParsedMissing({ id }))
        : Effect.succeed(
            new ParsedBook({
              version: PARSED_VERSION,
              pageCount: 1,
              charCount: 1,
              blocks: Array.from(
                { length: blocks },
                (_, at) => new Block({ kind: "paragraph", level: 0, text: `b${at}`, page: 1 }),
              ),
              toc: [],
              figuresThrough: 0,
            }),
          ),
    putProgress: (_id, progress) =>
      Effect.sync(() => {
        state.progress = progress;
      }),
    getProgress: () => Effect.succeed(state.progress),
  });
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
  const place = new ReadingProgress({
    blockIndex: 24,
    percent: 0.24,
    updatedAt: 5,
    furthest: 30,
  });

  it("given a parsed book, puts the position at the end and keeps the time", async () => {
    const { layer, state } = harness(place, 101);

    await Effect.runPromise(setBookFinished("b1", true, place).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 100,
      percent: 1,
      updatedAt: 5,
      furthest: 100,
      finished: true,
    });
  });

  it("given Finished turned off, goes back to the place the sheet opened at", async () => {
    const { layer, state } = harness(place, 101);

    await Effect.runPromise(setBookFinished("b1", true, place).pipe(Effect.provide(layer)));
    await Effect.runPromise(setBookFinished("b1", false, place).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 24,
      percent: 0.24,
      updatedAt: 5,
      furthest: 30,
      finished: false,
    });
  });

  it("given no parsed text, stores Finished without moving the book", async () => {
    const { layer, state } = harness(null);

    await Effect.runPromise(setBookFinished("b1", true, null).pipe(Effect.provide(layer)));

    expect(state.progress).toMatchObject({
      blockIndex: 0,
      percent: 0,
      updatedAt: 0,
      finished: true,
    });
    expect(state.progress?.furthest).toBeUndefined();
  });
});
