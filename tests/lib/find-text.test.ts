import { describe, expect, it } from "vitest";
import { findPages, pageSearchText, searchForm } from "@/lib/find-text";

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

  it("lists each page that may hold a match once, in order, with the page a last block runs on to", () => {
    expect(findPages(blocks, "river")).toEqual([2, 3, 5]);
  });

  it("matches across a line break and in any case", () => {
    expect(findPages(blocks, "OLD river")).toEqual([2, 3]);
  });

  it("given a match in a block that runs on to the next page, lists both pages", () => {
    const spanning = [
      { text: "a paragraph that turns the page and ends", page: 7 },
      { text: "the next paragraph", page: 8 },
    ];
    expect(findPages(spanning, "ends")).toEqual([7, 8]);
  });

  it("finds nothing for an empty or blank query", () => {
    expect(findPages(blocks, "")).toEqual([]);
    expect(findPages(blocks, "   ")).toEqual([]);
  });

  it("sorts pages even when blocks arrive out of order", () => {
    expect(findPages([...blocks].reverse(), "river")).toEqual([2, 5]);
  });
});

describe("pageSearchText", () => {
  it("joins runs end to end and reads a line end as a space, as the text layer does", () => {
    expect(
      pageSearchText([{ str: "The Old", hasEOL: true }, { str: "River" }, { str: " mill" }]),
    ).toBe("the old river mill");
  });
});
