import { describe, expect, it } from "vitest";
import { findPages, pageSearchText, searchForm } from "@/lib/find-text";

describe("searchForm", () => {
  it("given mixed case and a run of spaces, folds them to one lower-case form", () => {
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

  it("given a query on several pages, lists each page once in order", () => {
    expect(findPages(blocks, "river")).toEqual([2, 3, 5]);
  });

  it("given a query across a line break, matches in any case", () => {
    expect(findPages(blocks, "OLD river")).toEqual([2, 3]);
  });

  it("given a match in a block that runs on to the next page, lists both pages", () => {
    const spanning = [
      { text: "a paragraph that turns the page and ends", page: 7 },
      { text: "the next paragraph", page: 8 },
    ];
    expect(findPages(spanning, "ends")).toEqual([7, 8]);
  });

  it("given an empty or blank query, finds nothing", () => {
    expect(findPages(blocks, "")).toEqual([]);
    expect(findPages(blocks, "   ")).toEqual([]);
  });

  it("given blocks out of order, sorts the pages", () => {
    expect(findPages([...blocks].reverse(), "river")).toEqual([2, 5]);
  });
});

describe("pageSearchText", () => {
  it("given runs with a line end, joins them as the text layer does", () => {
    expect(
      pageSearchText([{ str: "The Old", hasEOL: true }, { str: "River" }, { str: " mill" }]),
    ).toBe("the old river mill");
  });
});
