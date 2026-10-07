import { describe, expect, it } from "vitest";
import { Block, PARSED_VERSION, ParsedBook, TocEntry } from "@/domain/book";
import { chapterAt, chapterText, recentPages } from "@/use-cases/ai-context";

const paragraph = (text: string, page: number): Block =>
  new Block({ kind: "paragraph", level: 0, text, page });
const heading = (text: string, page: number): Block =>
  new Block({ kind: "heading", level: 1, text, page });

// Two chapters of three paragraphs each, with a figure in the second.
const blocks = [
  heading("Chapter 1", 1),
  paragraph("one one one", 1),
  paragraph("two two", 1),
  paragraph("three", 2),
  heading("Chapter 2", 3),
  paragraph("four four", 3),
  new Block({ kind: "image", level: 0, text: "", page: 3, imageId: "3-0" }),
  paragraph("five", 4),
  paragraph("six six six", 4),
];

const book = (toc: ReadonlyArray<TocEntry>): ParsedBook =>
  new ParsedBook({
    version: PARSED_VERSION,
    pageCount: 4,
    charCount: 60,
    blocks,
    toc: [...toc],
    figuresThrough: 0,
  });

const withToc = book([
  new TocEntry({ title: "Chapter 1", page: 1, blockIndex: 0, depth: 0 }),
  new TocEntry({ title: "Chapter 2", page: 3, blockIndex: 4, depth: 0 }),
]);

describe("chapterAt", () => {
  it("given a contents list, returns the entry at or before the index and its end", () => {
    expect(chapterAt(withToc, 5)).toEqual({ heading: "Chapter 2", start: 4, end: 9 });
    expect(chapterAt(withToc, 2)).toEqual({ heading: "Chapter 1", start: 0, end: 4 });
  });

  it("given no contents list, falls back to the heading blocks", () => {
    expect(chapterAt(book([]), 7)).toEqual({ heading: "Chapter 2", start: 4, end: 9 });
  });

  it("given an index before any entry, returns an empty heading from the start", () => {
    const late = book([new TocEntry({ title: "Chapter 2", page: 3, blockIndex: 4, depth: 0 })]);
    expect(chapterAt(late, 1)).toEqual({ heading: "", start: 0, end: 4 });
  });
});

describe("recentPages", () => {
  it("given a word limit, takes the blocks up to and including the top block and nothing after", () => {
    const passage = recentPages(withToc, 5, 4);
    expect(passage.text).toBe("three\n\nChapter 2\n\nfour four");
    expect(passage.heading).toBe("Chapter 2");
    expect(passage.page).toBe(3);
  });

  it("given a figure in the span, leaves it out of the text", () => {
    expect(recentPages(withToc, 8, 100).text).not.toContain("\n\n\n");
    expect(recentPages(withToc, 8, 100).text.endsWith("five\n\nsix six six")).toBe(true);
  });
});

describe("chapterText", () => {
  it("given a story, ends the chapter at the position", () => {
    expect(chapterText(withToc, 5, "story").text).toBe("Chapter 2\n\nfour four");
  });

  it("given a reference document, sends the whole section", () => {
    expect(chapterText(withToc, 5, "reference").text).toBe(
      "Chapter 2\n\nfour four\n\nfive\n\nsix six six",
    );
  });
});
