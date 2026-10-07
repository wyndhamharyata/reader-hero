import { describe, expect, it } from "vitest";
import { Block, BookMeta, PARSED_VERSION, ParsedBook } from "@/domain/book";
import { guessKind } from "@/lib/guess-kind";

const meta = new BookMeta({
  id: "b",
  title: "T",
  addedAt: 0,
  fileSize: 1,
  pageCount: 300,
  parseState: "ready",
  charCount: 300 * 2000,
});

const block = (text: string, page: number, kind: Block["kind"] = "paragraph"): Block =>
  new Block({ kind, level: kind === "heading" ? 2 : 0, text, page });

const book = (pageCount: number, blocks: ReadonlyArray<Block>): ParsedBook =>
  new ParsedBook({
    version: PARSED_VERSION,
    pageCount,
    charCount: pageCount * 2000,
    blocks: [...blocks],
    toc: [],
    figuresThrough: 0,
  });

// Sixty paragraphs, a share of them with dialogue.
const prose = (quoted: number): Array<Block> =>
  Array.from({ length: 60 }, (_, index) =>
    block(index < quoted ? `"Come along," she said, and we went.` : "The road ran on.", index + 1),
  );

describe("guessKind", () => {
  it("given a novel with dialogue and chapter headings, picks story", () => {
    const novel = book(300, [block("Chapter 1", 1, "heading"), ...prose(25)]);
    expect(guessKind(meta, novel)).toBe("story");
  });

  it("given a novel with Japanese brackets for dialogue, picks story", () => {
    const quoted = Array.from({ length: 60 }, (_, index) =>
      block("「行こう」と彼女は言った。", index + 1),
    );
    expect(guessKind(meta, book(300, quoted))).toBe("story");
  });

  it("given a novel with little dialogue and no section names, still picks story", () => {
    expect(guessKind(meta, book(300, [block("Part One", 1, "heading"), ...prose(1)]))).toBe(
      "story",
    );
  });

  it("given a short paper, picks reference because it opens in the original view", () => {
    const paper = book(12, [block("Abstract", 1, "heading"), block("References", 11, "heading")]);
    expect(guessKind(new BookMeta({ ...meta, pageCount: 12 }), paper)).toBe("reference");
  });

  it("given a long manual with numbered sections and no dialogue, picks reference", () => {
    const manual = book(300, [
      block("1. Overview", 1, "heading"),
      block("2.1. Installation", 3, "heading"),
      block("2.2. Configuration", 5, "heading"),
      ...prose(0),
    ]);
    expect(guessKind(meta, manual)).toBe("reference");
  });

  it("given a long report with an introduction and a conclusion, picks reference", () => {
    const report = book(300, [
      block("Introduction", 1, "heading"),
      block("Conclusion", 280, "heading"),
      ...prose(10),
    ]);
    expect(guessKind(meta, report)).toBe("reference");
  });
});
