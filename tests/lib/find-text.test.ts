import { describe, expect, it } from "vitest";
import { findPages, searchForm } from "@/lib/find-text";

describe("searchForm", () => {
  it("lowers case and folds whitespace runs to one space", () => {
    expect(searchForm("The  Quick\nBrown\tFox")).toBe("the quick brown fox");
  });
});

describe("findPages", () => {
  const blocks = [
    { text: "Chapter one begins", page: 1 },
    { text: "the river runs", page: 2 },
    { text: "past the old\nRiver mill", page: 2 },
    { text: "nothing here", page: 3 },
    { text: "a river again", page: 5 },
  ];

  it("lists each page with a match once, in order", () => {
    expect(findPages(blocks, "river")).toEqual([2, 5]);
  });

  it("matches across a line break and in any case", () => {
    expect(findPages(blocks, "OLD river")).toEqual([2]);
  });

  it("finds nothing for an empty or blank query", () => {
    expect(findPages(blocks, "")).toEqual([]);
    expect(findPages(blocks, "   ")).toEqual([]);
  });

  it("sorts pages even when blocks arrive out of order", () => {
    expect(findPages([...blocks].reverse(), "river")).toEqual([2, 5]);
  });
});
