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

  it("given series without a colour, gives them the palette in turn, oldest first, and keeps a stored colour", () => {
    const saga = (name: string, id: string, addedAt: number) =>
      [1, 2].map((volume) =>
        book(`${id}${volume}`, `${name} Vol. ${volume}`, { addedAt: addedAt + volume }),
      );
    const library = [
      ...saga("Newer Saga", "n", 10),
      ...saga("Older Saga", "o", 0),
      ...saga("Chosen Saga", "c", 20),
    ];
    const chosen = seriesRecord({
      id: "chosen saga",
      name: "Chosen Saga",
      edited: true,
      books: [{ id: "c1" }, { id: "c2" }],
      color: 300,
    });
    const colours = (shelfBooks: ReadonlyArray<BookMeta>) =>
      new Map(
        buildShelf(shelfBooks, new Map(), "", none, "title", [chosen]).series.map((group) => [
          group.name,
          group.color,
        ]),
      );

    expect(colours(library)).toEqual(
      new Map([
        ["Newer Saga", 75],
        ["Older Saga", 15],
        ["Chosen Saga", 300],
      ]),
    );
    expect(colours([...library, ...saga("Newest Saga", "w", 30)])).toEqual(
      new Map([
        ["Newer Saga", 75],
        ["Older Saga", 15],
        ["Chosen Saga", 300],
        ["Newest Saga", 195],
      ]),
    );
  });

  it("given titles that end in a volume number, makes a series of 2 or more and keeps side series apart", () => {
    const jobless = [1, 2, 10, 12].map((volume) =>
      book(`j${volume}`, `Mushoku Tensei: Jobless Reincarnation Vol. ${volume}`, { addedAt: 1 }),
    );
    const redundant = [1, 2, 3].map((volume) =>
      book(`r${volume}`, `Mushoku Tensei: Redundant Reincarnation Vol. ${volume}`, { addedAt: 1 }),
    );
    const pair = [
      book("d1", "Dune Book 1", { addedAt: 1 }),
      book("d2", "Dune Book 2", { addedAt: 1 }),
    ];
    const single = book("c", "Catch 22", { addedAt: 1 });
    const shelf = buildShelf(
      [...jobless, ...redundant, ...pair, single],
      new Map(),
      "",
      none,
      "title",
    );

    expect(
      shelf.items.map((item) =>
        item.kind === "series"
          ? [item.name, item.books.map((card) => card.book.id)]
          : item.card.book.id,
      ),
    ).toEqual([
      "c",
      ["Dune", ["d1", "d2"]],
      ["Mushoku Tensei: Jobless Reincarnation", ["j1", "j2", "j10", "j12"]],
      ["Mushoku Tensei: Redundant Reincarnation", ["r1", "r2", "r3"]],
    ]);
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

  it("given a removed series, keeps its books out and lets new books start it again", () => {
    const removed = seriesRecord({
      id: "the tide cycle",
      name: "The Tide Cycle",
      removed: ["1", "2"],
      hidden: true,
    });
    const tideBooks = ["1", "2", "3", "4"].map((id) =>
      book(id, `Volume ${id}`, { series: "The Tide Cycle" }),
    );
    const shelf = buildShelf(tideBooks, new Map(), "", none, "added", [removed]);
    const old = buildShelf(tideBooks.slice(0, 2), new Map(), "", none, "added", [
      seriesRecord({ id: "the tide cycle", name: "The Tide Cycle", hidden: true }),
    ]);

    expect(
      shelf.items.map((item) =>
        item.kind === "series" ? item.books.map((card) => card.book.id) : item.card.book.id,
      ),
    ).toEqual([["3", "4"], "2", "1"]);
    expect(old.items.map((item) => item.kind)).toEqual(["series"]);
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

  it("given Finished set by hand below 98%, uses it for the badge, filter and 100%", () => {
    const reading = new Map([
      ["1", new ReadingProgress({ blockIndex: 24, percent: 0.24, updatedAt: 5, finished: true })],
    ]);
    const shelf = buildShelf(books, reading, "1", none, "added");
    const finished = buildShelf(books, reading, "", { ...none, status: "finished" }, "added");
    const card = shelfCards(shelf).find((entry) => entry.book.id === "1");

    expect(card?.badge.label).toBe("Finished");
    expect(card?.percent).toBe(1);
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
    expect(shelfCards(shelf).find((card) => card.book.id === "1")?.percent).toBe(0.99);
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
