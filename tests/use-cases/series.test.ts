import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { BookMeta, ReadingProgress, Series } from "@/domain/book";
import { buildShelf } from "@/lib/shelf";
import { BookStore } from "@/services/book-store";
import { findBookSeries, hideSeries, saveSeries, setBookSeries } from "@/use-cases/series";

const book = (id: string, title: string, overrides: Partial<BookMeta> = {}): BookMeta =>
  new BookMeta({
    id,
    title,
    author: "R. Aster",
    addedAt: 1,
    fileSize: 1,
    pageCount: 300,
    parseState: "ready",
    charCount: 1,
    ...overrides,
  });

const record = (fields: Partial<Series> & Pick<Series, "id" | "name">): Series =>
  new Series({ books: [], possible: [], removed: [], ...fields });

const tide = [
  book("b1", "Beacon at Low Water", { series: "The Tide Cycle", seriesNumber: 1 }),
  book("b2", "The Quiet Shoal", { series: "The Tide Cycle", seriesNumber: 2 }),
  book("b3", "Salt Memory", { series: "The Tide Cycle", seriesNumber: 3 }),
  book("b4", "The Deep Index", { series: "The Tide Cycle", seriesNumber: 4 }),
];
const lantern = book("l", "Lantern Keepers", { author: "H. Dahl" });
const harbor = book("h", "Harbor Lights: Stories");

// A store over plain arrays: the series records change as the use cases write them.
const run = async <A>(
  effect: Effect.Effect<A, unknown, BookStore>,
  state: {
    books: ReadonlyArray<BookMeta>;
    series: Array<Series>;
    progress?: ReadonlyMap<string, ReadingProgress>;
    reads?: Array<string>;
  },
): Promise<A> => {
  const layer = Layer.succeed(
    BookStore,
    BookStore.of({
      list: () => Effect.succeed(state.books),
      listSeries: () => Effect.sync(() => [...state.series]),
      getSeries: (id) => Effect.sync(() => state.series.find((series) => series.id === id) ?? null),
      putSeries: (series) =>
        Effect.sync(() => {
          state.series = [...state.series.filter((entry) => entry.id !== series.id), series];
        }),
      removeSeries: () => Effect.die("not used"),
      get: () => Effect.die("not used"),
      putMeta: () => Effect.die("not used"),
      putFile: () => Effect.die("not used"),
      getFile: () => Effect.die("not used"),
      putParsed: () => Effect.die("not used"),
      getParsed: () => Effect.die("not used"),
      putImage: () => Effect.die("not used"),
      updates: () => Stream.empty,
      getImage: () => Effect.die("not used"),
      listImages: () => Effect.die("not used"),
      putProgress: () => Effect.die("not used"),
      getProgress: (id) =>
        Effect.sync(() => {
          state.reads?.push(id);
          return state.progress?.get(id) ?? null;
        }),
      getPrefs: () => Effect.die("not used"),
      putPrefs: () => Effect.die("not used"),
      getFigureCheckpoint: () => Effect.die("not used"),
      putFigureCheckpoint: () => Effect.die("not used"),
      putPages: () => Effect.die("not used"),
      getPages: () => Effect.die("not used"),
      deletePages: () => Effect.die("not used"),
      remove: () => Effect.die("not used"),
      estimate: () => Effect.succeed(null),
      requestPersistent: () => Effect.succeed(false),
      takeInbox: () => Effect.succeed([]),
    }),
  );
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
};

const none = { status: null, length: null, author: null } as const;
const groupOf = (books: ReadonlyArray<BookMeta>, series: ReadonlyArray<Series>, id: string) =>
  buildShelf(books, new Map(), "", none, "added", series).series.find((group) =>
    group.books.some((card) => card.book.id === id),
  );

describe("saveSeries", () => {
  it("given a series from the EPUB fields, stores the reader's name and order under the same id", async () => {
    const state = { books: tide, series: [] as Array<Series> };

    await run(
      saveSeries({
        id: "the tide cycle",
        name: " Tide Cycle ",
        books: ["b1", "b2", "b4", "b3"],
        removed: [],
      }),
      state,
    );

    expect(state.series).toEqual([
      new Series({
        id: "the tide cycle",
        name: "Tide Cycle",
        books: [{ id: "b1" }, { id: "b2" }, { id: "b4" }, { id: "b3" }],
        possible: [],
        edited: true,
        removed: [],
      }),
    ]);
    expect(groupOf(tide, state.series, "b1")?.books.map((card) => card.book.id)).toEqual([
      "b1",
      "b2",
      "b4",
      "b3",
    ]);
  });

  it("given a book removed with ×, keeps it out although its EPUB fields name the series", async () => {
    const state = { books: tide, series: [] as Array<Series> };

    await run(
      saveSeries({
        id: "the tide cycle",
        name: "The Tide Cycle",
        books: ["b1", "b2", "b3"],
        removed: ["b4"],
      }),
      state,
    );

    expect(state.series[0]?.removed).toEqual(["b4"]);
    expect(groupOf(tide, state.series, "b1")?.count).toBe(3);
    expect(groupOf(tide, state.series, "b4")).toBeUndefined();
  });

  it("given a colour, stores it, and a later save without one keeps it", async () => {
    const state = { books: tide, series: [] as Array<Series> };
    const edit = { id: "the tide cycle", name: "The Tide Cycle", books: ["b1", "b2", "b3"] };

    await run(saveSeries({ ...edit, removed: [], color: 145 }), state);
    await run(saveSeries({ ...edit, removed: ["b4"] }), state);

    expect(state.series[0]?.color).toBe(145);
    expect(groupOf(tide, state.series, "b1")?.color).toBe(145);
  });

  it("given a cover, stores it, a save without one keeps it, and null goes back to the default", async () => {
    const state = { books: tide, series: [] as Array<Series> };
    const edit = { id: "the tide cycle", name: "The Tide Cycle", books: ["b1", "b2", "b3"] };

    await run(saveSeries({ ...edit, removed: [], cover: "b2" }), state);
    await run(saveSeries({ ...edit, removed: ["b4"] }), state);

    expect(state.series[0]?.cover).toBe("b2");
    expect(groupOf(tide, state.series, "b1")?.cover).toBe("b2");

    await run(saveSeries({ ...edit, removed: [], cover: null }), state);

    expect(state.series[0]?.cover).toBeUndefined();
  });

  it("given a book of another stored series, moves it and keeps the stored numbers", async () => {
    const books = [...tide, lantern];
    const state = {
      books,
      series: [
        record({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [
            { id: "b1", number: 1 },
            { id: "b2", number: 2 },
          ],
          possible: [{ id: "h" }],
          removed: ["l"],
        }),
        record({
          id: "lighthouse tales",
          name: "Lighthouse Tales",
          books: [{ id: "l" }, { id: "x" }],
          possible: [{ id: "b2" }],
        }),
      ],
    };

    await run(
      saveSeries({
        id: "the tide cycle",
        name: "The Tide Cycle",
        books: ["b1", "b2", "b3", "b4", "l"],
        removed: [],
      }),
      state,
    );

    const lighthouse = state.series.find((series) => series.id === "lighthouse tales");
    const saved = state.series.find((series) => series.id === "the tide cycle");
    expect(lighthouse?.books).toEqual([{ id: "x" }]);
    expect(lighthouse?.possible).toEqual([]);
    expect(lighthouse?.removed).toEqual(["l"]);
    expect(saved?.books).toEqual([
      { id: "b1", number: 1 },
      { id: "b2", number: 2 },
      { id: "b3" },
      { id: "b4" },
      { id: "l" },
    ]);
    expect(saved?.possible).toEqual([{ id: "h" }]);
    expect(saved?.removed).toEqual([]);
    expect(groupOf(books, state.series, "l")?.id).toBe("the tide cycle");
  });

  it("given a new series with the name of a shown one, joins it after its books", async () => {
    const books = [...tide, harbor];
    const state = { books, series: [] as Array<Series> };

    await run(saveSeries({ id: null, name: "The Tide  Cycle", books: ["h"], removed: [] }), state);

    expect(state.series[0]?.id).toBe("the tide cycle");
    expect(state.series[0]?.books.map((entry) => entry.id)).toEqual(["b1", "b2", "b3", "b4", "h"]);
  });

  it("given a new series of one book, stores it under the id of its name", async () => {
    const state = { books: [harbor], series: [] as Array<Series> };

    await run(saveSeries({ id: null, name: "Harbor Stories", books: ["h"], removed: [] }), state);

    expect(state.series[0]?.id).toBe("harbor stories");
    expect(groupOf([harbor], state.series, "h")?.name).toBe("Harbor Stories");
  });

  it("given a Possible book added with +, stores it in its place with the model's number", async () => {
    const books = [lantern, harbor, book("k", "The Keeper")];
    const state = {
      books,
      series: [
        record({
          id: "lights",
          name: "Lights",
          books: [
            { id: "l", number: 1 },
            { id: "k", number: 3 },
          ],
          possible: [{ id: "h", number: 2 }],
        }),
      ],
    };

    await run(
      saveSeries({ id: "lights", name: "Lights", books: ["l", "h", "k"], removed: [] }),
      state,
    );

    expect(state.series[0]?.books).toEqual([
      { id: "l", number: 1 },
      { id: "h", number: 2 },
      { id: "k", number: 3 },
    ]);
    expect(state.series[0]?.possible).toEqual([]);
    expect(state.series[0]?.edited).toBe(true);
  });
});

describe("hideSeries", () => {
  it("given a series from the EPUB fields, keeps its books out and lets new books start it again", async () => {
    const state = { books: tide, series: [] as Array<Series> };

    await run(hideSeries("the tide cycle", "The Tide Cycle"), state);

    expect(state.series[0]).toMatchObject({ books: [], removed: ["b1", "b2", "b3", "b4"] });
    expect(state.series[0]?.edited).toBeUndefined();
    expect(groupOf(tide, state.series, "b1")).toBeUndefined();
    expect(buildShelf(tide, new Map(), "", none, "added", state.series).items).toHaveLength(4);

    const again = [
      ...tide,
      book("b5", "Beacon at Low Water", { series: "The Tide Cycle", seriesNumber: 1 }),
      book("b6", "The Quiet Shoal", { series: "The Tide Cycle", seriesNumber: 2 }),
    ];
    expect(groupOf(again, state.series, "b5")?.books.map((card) => card.book.id)).toEqual([
      "b5",
      "b6",
    ]);
  });
});

describe("setBookSeries", () => {
  it("given None, writes the series without the book, as the reader's, with the book in removed", async () => {
    const state = { books: tide, series: [] as Array<Series> };

    await run(setBookSeries("b2", null), state);

    expect(state.series).toEqual([
      new Series({
        id: "the tide cycle",
        name: "The Tide Cycle",
        books: [{ id: "b1" }, { id: "b3" }, { id: "b4" }],
        possible: [],
        edited: true,
        removed: ["b2"],
      }),
    ]);
    expect(groupOf(tide, state.series, "b2")).toBeUndefined();
  });

  it("given another series, moves the book to its end and keeps it out of its old series", async () => {
    const books = [...tide, lantern, book("m", "Mast Light", { author: "H. Dahl" })];
    const state = {
      books,
      series: [
        record({
          id: "lighthouse tales",
          name: "Lighthouse Tales",
          books: [{ id: "l" }, { id: "m" }],
        }),
      ],
    };

    await run(setBookSeries("l", "the tide cycle"), state);

    expect(state.series.find((series) => series.id === "lighthouse tales")?.books).toEqual([
      { id: "m" },
    ]);
    expect(state.series.find((series) => series.id === "lighthouse tales")?.removed).toEqual(["l"]);
    expect(groupOf(books, state.series, "l")?.books.map((card) => card.book.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "l",
    ]);
    expect(state.series.find((series) => series.id === "the tide cycle")?.edited).toBe(true);
  });

  it("given a book removed earlier, adds it back and clears it from removed", async () => {
    const state = {
      books: tide,
      series: [
        record({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
          edited: true,
          removed: ["b4"],
        }),
      ],
    };

    await run(setBookSeries("b4", "the tide cycle"), state);

    expect(state.series[0]?.removed).toEqual([]);
    expect(groupOf(tide, state.series, "b4")?.count).toBe(4);
  });
});

describe("findBookSeries", () => {
  it("given a book in a series, returns the series in order with badges, reading only its books' progress", async () => {
    const reads: Array<string> = [];
    const state = {
      books: [...tide, lantern],
      series: [] as Array<Series>,
      progress: new Map([
        ["b1", new ReadingProgress({ blockIndex: 100, percent: 1, updatedAt: 1 })],
        ["b3", new ReadingProgress({ blockIndex: 23, percent: 0.23, updatedAt: 2 })],
      ]),
      reads,
    };

    const found = await run(findBookSeries("b3"), state);

    expect(found?.name).toBe("The Tide Cycle");
    expect(found?.books.map((card) => [card.book.id, card.badge.label])).toEqual([
      ["b1", "Finished"],
      ["b2", "Not started"],
      ["b3", "Reading"],
      ["b4", "Not started"],
    ]);
    expect(reads.sort()).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("given a book alone in its series or in none, returns null", async () => {
    const state = {
      books: [book("b1", "Beacon at Low Water", { series: "The Tide Cycle" }), lantern],
      series: [] as Array<Series>,
    };

    expect(await run(findBookSeries("b1"), state)).toBeNull();
    expect(await run(findBookSeries("l"), state)).toBeNull();
  });
});
