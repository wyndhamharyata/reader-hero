import { describe, expect, it } from "vitest";
import { Block, BookMeta, PARSED_VERSION, ParsedBook } from "@/domain/book";
import { guessMode } from "@/lib/guess-mode";

const meta = (overrides: Partial<BookMeta> = {}): BookMeta =>
  new BookMeta({
    id: "b",
    title: "T",
    addedAt: 0,
    fileSize: 1,
    pageCount: 10,
    parseState: "ready",
    charCount: 1,
    ...overrides,
  });

const block = (text: string, page: number, kind: Block["kind"] = "paragraph"): Block =>
  new Block({ kind, level: kind === "heading" ? 2 : 0, text, page });

const book = (pageCount: number, perPage: number, blocks: ReadonlyArray<Block>): ParsedBook =>
  new ParsedBook({
    version: PARSED_VERSION,
    pageCount,
    charCount: pageCount * perPage,
    blocks: [...blocks],
    toc: [],
    figuresThrough: 0,
  });

describe("guessMode", () => {
  it("given a long novel with chapter headings, picks reader mode", () => {
    const novel = book(320, 1800, [
      block("Prologue", 1, "heading"),
      block("Chapter 1: The Boy", 5, "heading"),
      block("Epilogue", 310, "heading"),
    ]);

    expect(guessMode(meta(), novel)).toBe("reader");
  });

  it("given a short paper with numbered sections, picks the original view", () => {
    const paper = book(12, 4200, [
      block("Abstract", 1, "heading"),
      block("1. Introduction", 1, "heading"),
      block("IV. RESULTS", 6),
      block("References", 11, "heading"),
    ]);

    expect(guessMode(meta(), paper)).toBe("original");
  });

  it("given an Indonesian report, recognises its section names", () => {
    const report = book(60, 2500, [
      block("BAB I PENDAHULUAN", 2, "heading"),
      block("BAB V KESIMPULAN", 50, "heading"),
      block("Daftar Pustaka:", 58, "heading"),
    ]);

    expect(guessMode(meta(), report)).toBe("original");
  });

  it("given sparse pages such as slides, picks the original view", () => {
    expect(guessMode(meta(), book(30, 250, [block("Teori Graf", 1, "heading")]))).toBe("original");
  });

  it("given a scanned book, picks the original view", () => {
    expect(guessMode(meta({ parseState: "scanned" }), book(200, 2000, []))).toBe("original");
  });

  it("given a 2-page assignment with no section names, picks the original view", () => {
    const assignment = book(2, 2200, [
      block("Tugas Sesi 13: Penerapan Graph Algorithm pada Studi Kasus", 1, "heading"),
      block("Studi kasus", 1),
      block("Algoritma Kruskal", 1),
    ]);

    expect(guessMode(meta(), assignment)).toBe("original");
  });

  it("given a 25-page handout with numbered sections, picks the original view", () => {
    const handout = book(25, 1800, [
      block("1. Konsep dan Komponen", 1, "heading"),
      block("3.1. Meningkatkan Kinerja Akademik", 4),
      block("4.2. Tekanan Akademik", 6),
      block("6. Kesimpulan", 9, "heading"),
    ]);

    expect(guessMode(meta(), handout)).toBe("original");
  });

  it("given a 60-page novella, stays in reader mode", () => {
    expect(guessMode(meta(), book(60, 1500, [block("Chapter 1", 1, "heading")]))).toBe("reader");
  });

  it("given a long book with an introduction only, stays in reader mode", () => {
    const nonfiction = book(240, 2200, [
      block("Introduction", 3, "heading"),
      block("Part One", 10),
    ]);

    expect(guessMode(meta(), nonfiction)).toBe("reader");
  });
});
