import { describe, expect, it } from "vitest";
import { chapterAt, chapterRange } from "@/lib/reader-window";

const spans = [
  { start: 0, end: 100 },
  { start: 100, end: 250 },
  { start: 250, end: 260 },
  { start: 260, end: 900 },
];

describe("chapterAt", () => {
  it("given a block, finds the chapter whose first block is at or above it", () => {
    expect([0, 99, 100, 249, 250, 259, 260, 899].map((at) => chapterAt(spans, at))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it("given a block past every chapter, keeps the last one", () => {
    expect(chapterAt(spans, 5000)).toBe(3);
  });

  it("given no chapters, answers the first", () => {
    expect(chapterAt([], 42)).toBe(0);
  });
});

describe("chapterRange", () => {
  it("given a chapter, covers it and one either side", () => {
    expect(chapterRange(spans, 2, 900)).toEqual({ start: 100, end: 900 });
  });

  it("given the first chapter, covers it and the one after", () => {
    expect(chapterRange(spans, 0, 900)).toEqual({ start: 0, end: 250 });
  });

  it("given the last chapter, covers the two before it", () => {
    expect(chapterRange(spans, 3, 900)).toEqual({ start: 250, end: 900 });
  });

  it("given blocks before the first chapter, covers them with it", () => {
    const after = [
      { start: 6, end: 100 },
      { start: 100, end: 200 },
    ];

    expect(chapterRange(after, 0, 200)).toEqual({ start: 0, end: 200 });
  });

  it("given no chapters, covers the whole book", () => {
    expect(chapterRange([], 0, 640)).toEqual({ start: 0, end: 640 });
  });

  it("given a chapter past the end of the blocks, never runs past them", () => {
    expect(
      chapterRange(
        [
          { start: 0, end: 900 },
          { start: 900, end: 9999 },
        ],
        1,
        900,
      ),
    ).toEqual({
      start: 0,
      end: 900,
    });
  });
});
