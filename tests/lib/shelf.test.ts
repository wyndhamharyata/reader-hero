import { describe, expect, it } from "vitest";
import { BookMeta, ReadingProgress } from "@/domain/book";
import { buildShelf, type Filters } from "@/lib/shelf";

const book = (id: string, title: string, overrides: Partial<BookMeta> = {}): BookMeta =>
  new BookMeta({
    id,
    title,
    addedAt: Number(id),
    fileSize: 1,
    pageCount: 300,
    parseState: "ready",
    charCount: 1,
    ...overrides,
  });

const read = (percent: number, updatedAt: number): ReadingProgress =>
  new ReadingProgress({ blockIndex: 0, percent, updatedAt });

const none: Filters = { status: null, series: null, length: null, author: null };

const series = [1, 2, 7, 10].map((volume) =>
  book(String(volume), `Mushoku Tensei: Jobless Reincarnation Vol. ${volume}`, {
    author: "Rifujin na Magonote",
  }),
);
const other = book("20", "Sesi 13 Algoritma Graf", { pageCount: 40 });
const books = [...series, other];

describe("buildShelf", () => {
  it("given more than 3 titles opening with the same words, names the series and cuts their start", () => {
    const shelf = buildShelf(books, new Map(), "", none, "added");

    const seriesChips = shelf.chips.find((group) => group.group === "series")?.chips ?? [];
    expect(seriesChips.map((chip) => [chip.label, chip.count])).toEqual([
      ["Mushoku Tensei: Jobless Reincarnation", 4],
    ]);
    expect(shelf.cards.filter((card) => card.clipStart)).toHaveLength(4);
    expect(shelf.cards.find((card) => card.book.id === "20")?.clipStart).toBe(false);
  });

  it("given a search with several words, keeps books that contain every word", () => {
    const shelf = buildShelf(books, new Map(), "tensei 7", none, "added");

    expect(shelf.cards.map((card) => card.book.id)).toEqual(["7"]);
    expect(shelf.matching).toBe(1);
  });

  it("given a status filter, counts the other groups' chips with that filter applied", () => {
    const reading = new Map([["2", read(0.5, 100)]]);
    const shelf = buildShelf(books, reading, "", { ...none, status: "reading" }, "added");

    expect(shelf.cards.map((card) => card.book.id)).toEqual(["2"]);
    expect(shelf.filtered).toBe(true);
    const lengthChips = shelf.chips.find((group) => group.group === "length")?.chips ?? [];
    expect(lengthChips.map((chip) => [chip.value, chip.count])).toEqual([["medium", 1]]);
  });

  it("given 98% or more, marks the book finished and shows the Finished badge", () => {
    const shelf = buildShelf(books, new Map([["1", read(0.99, 5)]]), "", none, "added");

    const card = shelf.cards.find((entry) => entry.book.id === "1");
    expect(card?.status).toBe("finished");
    expect(card?.badge.label).toBe("Finished");
  });

  it("given the recent sort, puts the last read book first and unread books by newest import", () => {
    const reading = new Map([
      ["1", read(0.1, 300)],
      ["7", read(0.2, 500)],
    ]);
    const shelf = buildShelf(books, reading, "", none, "recent");

    expect(shelf.cards.map((card) => card.book.id)).toEqual(["7", "1", "20", "10", "2"]);
  });

  it("given the title sort, orders volume numbers by value", () => {
    const shelf = buildShelf(series, new Map(), "", none, "title");

    expect(shelf.cards.map((card) => card.book.id)).toEqual(["1", "2", "7", "10"]);
  });
});
