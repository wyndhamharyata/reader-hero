import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeBookMeta, decodeSeries } from "@/lib/codecs";

describe("series metadata schemas", () => {
  it("given a BookMeta record from an older build, decodes without EPUB series fields", async () => {
    const meta = await Effect.runPromise(
      decodeBookMeta({
        id: "b1",
        title: "A Book",
        addedAt: 1,
        fileSize: 2,
        pageCount: 3,
        parseState: "ready",
        charCount: 4,
      }),
    );

    expect(meta.series).toBeUndefined();
    expect(meta.seriesNumber).toBeUndefined();
  });

  it("given a stored series, decodes order, possible books, and optional flags", async () => {
    const series = await Effect.runPromise(
      decodeSeries({
        id: "the tide cycle",
        name: "The Tide Cycle",
        books: [{ id: "b1", number: 2.5 }],
        possible: [{ id: "b2" }],
        removed: ["b3"],
      }),
    );

    expect(series.books).toEqual([{ id: "b1", number: 2.5 }]);
    expect(series.possible).toEqual([{ id: "b2" }]);
    expect(series.edited).toBeUndefined();
    expect(series.hidden).toBeUndefined();
  });
});
