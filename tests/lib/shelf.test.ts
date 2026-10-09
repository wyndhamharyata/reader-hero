import { describe, expect, it } from "vitest";
import { BookMeta, ReadingProgress, Series } from "@/domain/book";
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

const seriesRecord = (fields: Partial<Series> = {}): Series =>
  new Series({
    id: "sample series",
    name: "Sample series",
    books: [],
    possible: [],
    removed: [],
    ...fields,
  });

const shelfCards = (shelf: ReturnType<typeof buildShelf>) => {
  return shelf.items.flatMap((item) => (item.kind === "series" ? item.books : [item.card]));
};

const none: Filters = { status: null, length: null, author: null };

const titleSeries = [1, 2, 7, 10].map((volume) =>
  book(String(volume), `Mushoku Tensei: Jobless Reincarnation Vol. ${volume}`, {
    author: "Rifujin na Magonote",
  }),
);
const other = book("20", "Sesi 13 Algoritma Graf", { pageCount: 40 });
const books = [...titleSeries, other];

describe("buildShelf", () => {
  it("given more than 3 titles opening with the same words, returns one series item and clips their start", () => {
    const shelf = buildShelf(books, new Map(), "", none, "title");
    const group = shelf.items[0];

    expect(
      shelf.items.map((item) => (item.kind === "series" ? item.name : item.card.book.id)),
    ).toEqual(["Mushoku Tensei: Jobless Reincarnation", "20"]);
    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.id).toBe("mushoku tensei: jobless reincarnation");
    expect(group.books.map((card) => card.book.id)).toEqual(["1", "2", "7", "10"]);
    expect(group.books.every((card) => card.clipStart)).toBe(true);
    expect(group.status).toBe("not-started");
    expect(shelf.chips.map((entry) => entry.group)).not.toContain("series");
  });

  it("given a search for a title in a series, returns one book with its place and count", () => {
    const shelf = buildShelf(books, new Map(), "tensei 7", none, "added");
    const item = shelf.items[0];

    expect(shelf.items).toHaveLength(1);
    expect(item?.kind).toBe("book");
    if (item?.kind !== "book") return;
    expect(item.card.book.id).toBe("7");
    expect(item.card.series).toEqual({
      id: "mushoku tensei: jobless reincarnation",
      name: "Mushoku Tensei: Jobless Reincarnation",
      place: 3,
      count: 4,
    });
    expect(shelf.matching).toBe(1);
  });

  it("given a status filter, returns single books and counts the other chips with that filter", () => {
    const reading = new Map([["2", read(0.5, 100)]]);
    const shelf = buildShelf(books, reading, "", { ...none, status: "reading" }, "added");

    expect(shelf.items.map((item) => (item.kind === "book" ? item.card.book.id : item.id))).toEqual(
      ["2"],
    );
    if (shelf.items[0]?.kind === "book") {
      expect(shelf.items[0].card.series).toEqual({
        id: "mushoku tensei: jobless reincarnation",
        name: "Mushoku Tensei: Jobless Reincarnation",
        place: 2,
        count: 4,
      });
    }
    expect(shelf.filtered).toBe(true);
    const lengthChips = shelf.chips.find((group) => group.group === "length")?.chips ?? [];
    expect(lengthChips.map((chip) => [chip.value, chip.count])).toEqual([["medium", 1]]);
  });

  it("given EPUB series fields, orders by numeric series number then numeric title", () => {
    const volumes = [
      book("31", "Volume 10", { series: "The Tide Cycle", seriesNumber: 10 }),
      book("32", "Volume 2", { series: "The Tide Cycle", seriesNumber: 2 }),
      book("33", "Volume 2.5", { series: "The Tide Cycle", seriesNumber: 2.5 }),
      book("34", "Volume 12", { series: "The Tide Cycle" }),
      book("35", "Volume 3", { series: "The Tide Cycle" }),
    ];
    const shelf = buildShelf(volumes, new Map(), "", none, "added");
    const group = shelf.items[0];

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.id).toBe("the tide cycle");
    expect(group.books.map((card) => card.book.id)).toEqual(["32", "33", "31", "35", "34"]);
  });

  it("given fewer than 2 library books in a series, shows a single book without a series line", () => {
    const shelf = buildShelf(
      [book("1", "Volume One", { series: "The Tide Cycle", seriesNumber: 1 })],
      new Map(),
      "",
      none,
      "added",
    );
    const item = shelf.items[0];

    expect(item?.kind).toBe("book");
    if (item?.kind !== "book") return;
    expect(item.card.series).toBeUndefined();
    expect(item.card.seriesId).toBe("the tide cycle");
  });

  it("given a stored series, uses its name and order over EPUB fields", () => {
    const volumes = [
      book("11", "Title One", { series: "File Series", seriesNumber: 1 }),
      book("12", "Title Two", { series: "File Series", seriesNumber: 2 }),
      book("13", "Title Three", { series: "File Series", seriesNumber: 3 }),
    ];
    const edited = seriesRecord({
      id: "reader series",
      name: "Reader Order",
      edited: true,
      books: [
        { id: "13", number: 3 },
        { id: "11", number: 1 },
        { id: "12", number: 2 },
      ],
    });
    const shelf = buildShelf(volumes, new Map(), "", none, "title", [edited]);
    const group = shelf.items[0];

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.name).toBe("Reader Order");
    expect(group.books.map((card) => card.book.id)).toEqual(["13", "11", "12"]);
    expect(group.books.map((card) => card.series?.place)).toEqual([1, 2, 3]);
  });

  it("given a stored membership, uses it over the title-start fallback", () => {
    const edited = seriesRecord({
      id: "reader order",
      name: "Reader Order",
      edited: true,
      books: [{ id: "1" }],
    });
    const shelf = buildShelf(titleSeries, new Map(), "", none, "title", [edited]);
    const card = shelfCards(shelf).find((entry) => entry.book.id === "1");

    expect(card?.seriesId).toBe("reader order");
    expect(card?.clipStart).toBe(false);
  });

  it("given a new EPUB volume, places it by number without reordering stored books", () => {
    const stored = seriesRecord({
      id: "the tide cycle",
      name: "The Tide Cycle",
      books: [
        { id: "3", number: 3 },
        { id: "1", number: 1 },
      ],
    });
    const shelf = buildShelf(
      [
        book("1", "Volume One", { series: "The Tide Cycle", seriesNumber: 1 }),
        book("2", "Volume Two", { series: "The Tide Cycle", seriesNumber: 2 }),
        book("3", "Volume Three", { series: "The Tide Cycle", seriesNumber: 3 }),
      ],
      new Map(),
      "",
      none,
      "added",
      [stored],
    );
    const group = shelf.items[0];

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.books.map((card) => card.book.id)).toEqual(["2", "3", "1"]);
  });

  it("given a hidden series, suppresses the matching EPUB-derived series", () => {
    const hidden = seriesRecord({ id: "the tide cycle", name: "The Tide Cycle", hidden: true });
    const shelf = buildShelf(
      [book("1", "Volume One", { series: "The Tide Cycle" })],
      new Map(),
      "",
      none,
      "added",
      [hidden],
    );

    expect(shelf.items).toHaveLength(1);
    expect(shelf.items[0]?.kind).toBe("book");
    expect(shelfCards(shelf)[0]?.series).toBeUndefined();
  });

  it("given a removed book id, does not add it back from its EPUB fields", () => {
    const removed = seriesRecord({
      id: "the tide cycle",
      name: "The Tide Cycle",
      books: [{ id: "1" }],
      removed: ["2"],
    });
    const shelf = buildShelf(
      [
        book("1", "Volume One", { series: "The Tide Cycle" }),
        book("2", "Volume Two", { series: "The Tide Cycle" }),
        book("3", "Volume Three", { series: "The Tide Cycle" }),
      ],
      new Map(),
      "",
      none,
      "added",
      [removed],
    );
    const group = shelf.items.find((item) => item.kind === "series");

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.books.map((card) => card.book.id)).toEqual(["1", "3"]);
    expect(shelfCards(shelf).find((card) => card.book.id === "2")?.series).toBeUndefined();
  });

  it("given series with recent, added, and title sorts, places each group by its newest book", () => {
    const grouped = [
      book("1", "Alpha One", { series: "Alpha", addedAt: 1 }),
      book("2", "Alpha Two", { series: "Alpha", addedAt: 2 }),
      book("3", "Beta One", { series: "Beta", addedAt: 3 }),
      book("4", "Solo", { addedAt: 1 }),
      book("5", "Beta Two", { series: "Beta", addedAt: 0 }),
    ];
    const reading = new Map([
      ["1", read(0.2, 500)],
      ["2", read(0.3, 100)],
      ["3", read(0.1, 300)],
      ["4", read(0.1, 700)],
    ]);
    const added = buildShelf(grouped, reading, "", none, "added");
    const recent = buildShelf(grouped, reading, "", none, "recent");
    const title = buildShelf(grouped, reading, "", none, "title");

    expect(
      added.items.map((item) => (item.kind === "series" ? item.name : item.card.book.title)),
    ).toEqual(["Beta", "Alpha", "Solo"]);
    expect(
      recent.items.map((item) => (item.kind === "series" ? item.name : item.card.book.title)),
    ).toEqual(["Solo", "Alpha", "Beta"]);
    expect(
      title.items.map((item) => (item.kind === "series" ? item.name : item.card.book.title)),
    ).toEqual(["Alpha", "Beta", "Solo"]);
  });

  it("given progress within a series, exposes its book in progress and Finished count", () => {
    const stored = seriesRecord({
      id: "the tide cycle",
      name: "The Tide Cycle",
      books: [{ id: "1" }, { id: "2" }, { id: "3" }],
    });
    const progress = new Map([
      ["1", read(0.99, 10)],
      ["2", read(0.4, 20)],
    ]);
    const shelf = buildShelf(
      [book("1", "One"), book("2", "Two"), book("3", "Three")],
      progress,
      "",
      none,
      "added",
      [stored],
    );
    const group = shelf.items[0];

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.count).toBe(3);
    expect(group.finishedCount).toBe(1);
    expect(group.inProgress?.book.id).toBe("2");
    expect(group.status).toBe("reading");
  });

  it("given all books finished, marks the series Finished", () => {
    const stored = seriesRecord({
      id: "the tide cycle",
      name: "The Tide Cycle",
      books: [{ id: "1" }, { id: "2" }],
    });
    const progress = new Map([
      ["1", read(0.99, 10)],
      ["2", read(1, 20)],
    ]);
    const shelf = buildShelf([book("1", "One"), book("2", "Two")], progress, "", none, "added", [
      stored,
    ]);

    expect(shelf.items[0]?.kind).toBe("series");
    if (shelf.items[0]?.kind === "series") {
      expect(shelf.items[0].finishedCount).toBe(2);
      expect(shelf.items[0].status).toBe("finished");
    }
  });

  it("given 98% or more, marks the book finished and shows the Finished badge", () => {
    const shelf = buildShelf(books, new Map([["1", read(0.99, 5)]]), "", none, "added");
    const card = shelfCards(shelf).find((entry) => entry.book.id === "1");

    expect(card?.status).toBe("finished");
    expect(card?.badge.label).toBe("Finished");
  });

  it("given Finished set by hand below 98%, uses it for the badge and filter", () => {
    const reading = new Map([
      ["1", new ReadingProgress({ blockIndex: 24, percent: 0.24, updatedAt: 5, finished: true })],
    ]);
    const shelf = buildShelf(books, reading, "1", none, "added");
    const finished = buildShelf(books, reading, "", { ...none, status: "finished" }, "added");

    expect(shelfCards(shelf).find((card) => card.book.id === "1")?.badge.label).toBe("Finished");
    expect(finished.items.some((item) => item.kind === "book" && item.card.book.id === "1")).toBe(
      true,
    );
  });

  it("given a Finished book that needs a rebuild, keeps the parse badge", () => {
    const broken = book("21", "Unparsed", { parseState: "failed" });
    const reading = new Map([
      ["21", new ReadingProgress({ blockIndex: 0, percent: 0, updatedAt: 5, finished: true })],
    ]);
    const shelf = buildShelf([broken], reading, "", none, "added");
    const item = shelf.items[0];

    expect(item?.kind).toBe("book");
    if (item?.kind === "book") expect(item.card.badge.label).toBe("Failed");
  });

  it("given Finished turned off above 98%, keeps the book Reading and out of that filter", () => {
    const reading = new Map([
      ["1", new ReadingProgress({ blockIndex: 99, percent: 0.99, updatedAt: 5, finished: false })],
    ]);
    const shelf = buildShelf(books, reading, "1", none, "added");
    const finished = buildShelf(books, reading, "", { ...none, status: "finished" }, "added");
    const readingOnly = buildShelf(books, reading, "", { ...none, status: "reading" }, "added");

    expect(shelfCards(shelf).find((card) => card.book.id === "1")?.badge.label).toBe("Reading");
    expect(finished.items.some((item) => item.kind === "book" && item.card.book.id === "1")).toBe(
      false,
    );
    expect(
      readingOnly.items.some((item) => item.kind === "book" && item.card.book.id === "1"),
    ).toBe(true);
  });

  it("given a stored edit of a title-start series, keeps its clipped titles", () => {
    const stored = seriesRecord({
      id: "mushoku tensei: jobless reincarnation",
      name: "Jobless Reincarnation",
      books: ["10", "1", "2", "7"].map((id) => ({ id })),
      edited: true,
    });
    const group = buildShelf(books, new Map(), "", none, "title", [stored]).items[0];

    expect(group?.kind).toBe("series");
    if (group?.kind !== "series") return;
    expect(group.name).toBe("Jobless Reincarnation");
    expect(group.books.map((card) => [card.book.id, card.clipStart])).toEqual([
      ["10", true],
      ["1", true],
      ["2", true],
      ["7", true],
    ]);
  });

  it("given a search, still lists every series, also one of a single book, and every card", () => {
    const single = book("30", "Harbor Lights", { series: "Harbor Stories" });
    const shelf = buildShelf([...books, single], new Map(), "sesi", none, "added");

    expect(shelf.items).toHaveLength(1);
    expect(shelf.series.map((group) => [group.name, group.count])).toEqual([
      ["Mushoku Tensei: Jobless Reincarnation", 4],
      ["Harbor Stories", 1],
    ]);
    expect([...shelf.cards.keys()].sort()).toEqual(["1", "10", "2", "20", "30", "7"]);
  });
});
