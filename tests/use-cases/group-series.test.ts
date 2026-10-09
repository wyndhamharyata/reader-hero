import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, CONSENT_VERSION } from "@/domain/ai";
import { Block, BookMeta, PARSED_VERSION, ParsedBook, Series } from "@/domain/book";
import { AiFailure, ParsedMissing } from "@/domain/errors";
import { buildShelf } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { SettingsStore } from "@/services/settings-store";
import { groupSeries, resetGrouping } from "@/use-cases/group-series";

const book = (id: string, title: string, overrides: Partial<BookMeta> = {}): BookMeta =>
  new BookMeta({
    id,
    title,
    author: "R. Aster",
    fileName: `${id}.epub`,
    addedAt: 1,
    fileSize: 1,
    pageCount: 300,
    parseState: "ready",
    charCount: 1,
    ...overrides,
  });

const record = (fields: Partial<Series> & Pick<Series, "id" | "name">): Series =>
  new Series({ books: [], possible: [], removed: [], ...fields });

const allowed = (fields: Partial<AiSettings> = {}): AiSettings =>
  new AiSettings({
    provider: "deepseek",
    apiKey: "k",
    model: "flash",
    consentedAt: 1,
    consentVersion: CONSENT_VERSION,
    linesInContents: true,
    autoSummary: false,
    seriesGrouping: true,
    ...fields,
  });

const opening = new ParsedBook({
  version: PARSED_VERSION,
  pageCount: 1,
  charCount: 1,
  blocks: [
    new Block({ kind: "heading", level: 1, text: "THE QUIET SHOAL", page: 1 }),
    new Block({ kind: "image", level: 0, text: "", page: 1, imageId: "i1" }),
    new Block({
      kind: "paragraph",
      level: 0,
      text: `Book Two of The Tide Cycle.\n${Array.from({ length: 300 }, (_, at) => `w${at}`).join(" ")}`,
      page: 1,
    }),
  ],
  toc: [],
  figuresThrough: 0,
});

interface State {
  books: ReadonlyArray<BookMeta>;
  series: Array<Series>;
  sent: ReadonlyArray<string>;
}

// The key that the request gave a book, read back from its card line.
const keyOf = (user: string, title: string): string =>
  user
    .split("\n")
    .find((line) => line.includes(` | ${title} | `))
    ?.split(" | ")[0] ?? "missing";

function harness(state: State, reply: (user: string) => string) {
  const calls: Array<{ system: string; user: string; json: boolean }> = [];
  const open = { now: 0, peak: 0 };
  const client = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (_settings, system, messages, options) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const user = messages[0]?.content ?? "";
            calls.push({ system, user, json: options?.json === true });
            open.now += 1;
            open.peak = Math.max(open.peak, open.now);
            yield* Effect.sleep("2 millis");
            open.now -= 1;
            const text = reply(user);
            return Stream.fromArray([
              { type: "reasoning" as const, text: "hmm" },
              { type: "text" as const, text: text.slice(0, 7) },
              { type: "text" as const, text: text.slice(7) },
            ]);
          }),
        ),
      models: () => Effect.succeed([]),
      balance: () => Effect.succeed(null),
    }),
  );
  const books = Layer.succeed(
    BookStore,
    BookStore.of({
      list: () => Effect.sync(() => state.books),
      listSeries: () => Effect.sync(() => [...state.series]),
      getSeries: () => Effect.die("not used"),
      putSeries: (series) =>
        Effect.sync(() => {
          state.series = [...state.series.filter((entry) => entry.id !== series.id), series];
        }),
      removeSeries: (id) =>
        Effect.sync(() => {
          state.series = state.series.filter((entry) => entry.id !== id);
        }),
      get: () => Effect.die("not used"),
      putMeta: () => Effect.die("not used"),
      putFile: () => Effect.die("not used"),
      getFile: () => Effect.die("not used"),
      putParsed: () => Effect.die("not used"),
      getParsed: (id) =>
        id === "b2" ? Effect.succeed(opening) : Effect.fail(new ParsedMissing({ id })),
      putImage: () => Effect.die("not used"),
      updates: () => Stream.empty,
      getImage: () => Effect.die("not used"),
      listImages: () => Effect.die("not used"),
      putProgress: () => Effect.die("not used"),
      getProgress: () => Effect.die("not used"),
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
  const settings = Layer.succeed(
    SettingsStore,
    SettingsStore.of({
      changes: () => Stream.empty,
      update: () => Effect.die("not used"),
      aiChanges: () => Stream.empty,
      putAi: () => Effect.die("not used"),
      groupedBooks: () => Effect.sync(() => state.sent),
      putGroupedBooks: (ids) =>
        Effect.sync(() => {
          state.sent = ids;
        }),
    }),
  );
  const layer = Layer.mergeAll(client, books, settings);
  const left: Array<number> = [];
  const run = (ai: AiSettings | null = allowed()) =>
    Effect.runPromise(groupSeries(ai, (count) => left.push(count)).pipe(Effect.provide(layer)));
  const fail = (ai: AiSettings = allowed()) =>
    Effect.runPromise(groupSeries(ai, () => undefined).pipe(Effect.flip, Effect.provide(layer)));
  const reset = () => Effect.runPromise(resetGrouping().pipe(Effect.provide(layer)));
  return { calls, open, left, run, fail, reset };
}

const none = { status: null, length: null, author: null } as const;
const shown = (state: State) =>
  buildShelf(state.books, new Map(), "", none, "added", state.series)
    .series.filter((group) => group.count >= 2)
    .map((group) => [group.name, group.books.map((card) => card.book.id)]);

const tide = [
  book("b1", "Beacon at Low Water"),
  book("b2", "The Quiet Shoal"),
  book("b3", "Salt Memory"),
  book("b4", "The Deep Index"),
];
const tideReply = (user: string): string =>
  JSON.stringify({
    series: [
      {
        name: "The Tide Cycle",
        books: [
          { key: keyOf(user, "Salt Memory"), number: 3 },
          { key: keyOf(user, "Beacon at Low Water"), number: 1 },
          { key: keyOf(user, "The Deep Index") },
          { key: keyOf(user, "The Quiet Shoal"), number: 2 },
        ],
      },
    ],
  });

describe("groupSeries, when it sends", () => {
  it("given no provider, Series grouping off, no consent or the older consent, sends nothing", async () => {
    const state: State = { books: tide, series: [], sent: [] };
    const { calls, run } = harness(state, tideReply);

    expect(await run(null)).toBeNull();
    expect(await run(allowed({ seriesGrouping: false }))).toBeNull();
    expect(await run(allowed({ consentedAt: undefined }))).toBeNull();
    expect(await run(allowed({ consentVersion: undefined }))).toBeNull();

    expect(calls).toEqual([]);
    expect(state.series).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it("sends each book once, and after an import only the new book", async () => {
    const state: State = { books: tide.slice(0, 3), series: [], sent: [] };
    const { calls, run } = harness(state, tideReply);

    await run();
    await run();
    expect(calls).toHaveLength(1);

    state.books = tide;
    await run();
    expect(calls).toHaveLength(2);
    const cards = calls[1]?.user.split("Books:\n")[1] ?? "";
    expect(cards).toContain("| The Deep Index |");
    expect(cards).not.toContain("| Salt Memory |");
    expect([...state.sent].sort()).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("given a reset, drops the model's series and offers, brings removed series back, keeps the reader's, and sends every book again", async () => {
    const state: State = {
      books: tide,
      series: [
        record({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [{ id: "b1" }, { id: "b2" }],
        }),
        record({
          id: "saved",
          name: "Saved",
          books: [{ id: "b3" }],
          possible: [{ id: "b4" }],
          removed: ["b2"],
          edited: true,
        }),
        record({ id: "gone", name: "Gone", hidden: true }),
        record({ id: "kept", name: "Kept", books: [{ id: "b4" }], edited: true, hidden: true }),
      ],
      sent: ["b1", "b2", "b3", "b4"],
    };
    const { calls, run, reset } = harness(state, tideReply);

    await reset();
    expect(state.series.map((series) => series.id).sort()).toEqual(["kept", "saved"]);
    expect(state.series.find((series) => series.id === "kept")?.hidden).toBe(false);
    expect(state.series.find((series) => series.id === "saved")).toMatchObject({
      possible: [],
      removed: ["b2"],
      edited: true,
    });
    expect(state.sent).toEqual([]);

    await run();
    expect(calls).toHaveLength(1);
  });

  it("lists no series whose books go in the same request, and names side series apart", async () => {
    const saga = [1, 2, 3].map((volume) => book(`s${volume}`, `Saga Vol. ${volume}`));
    const state: State = { books: [...saga, ...tide], series: [], sent: ["b1", "b2", "b3", "b4"] };
    const { calls, run } = harness(state, () => JSON.stringify({ series: [] }));

    await run();
    expect(calls[0]?.user.startsWith("Books:\n")).toBe(true);
    expect(calls[0]?.user.split("\n").filter((line) => line.includes("| Saga Vol."))).toHaveLength(
      3,
    );
    expect(calls[0]?.system).toContain("A side series with its own numbering is a separate series");
  });

  it("does not send a book with EPUB series fields or a book that is still parsing", async () => {
    const state: State = {
      books: [
        book("e1", "Lantern Keepers", { series: "Lighthouse Tales", seriesNumber: 1 }),
        book("p1", "The Salt Roads", { parseState: "parsing" }),
      ],
      series: [],
      sent: [],
    };
    const { calls, run } = harness(state, tideReply);

    expect(await run()).toEqual({ books: 1, series: 0 });
    expect(calls).toEqual([]);
  });

  it("sends up to 30 books per request, sorted by author, and keeps an author's books together", async () => {
    const authored = (author: string, count: number) =>
      Array.from({ length: count }, (_, at) =>
        book(`${author}${at}`, `${author} ${at}`, { author }),
      );
    const state: State = {
      books: [
        ...authored("C", 20),
        ...authored("A", 20),
        ...authored("B", 25),
        ...authored("D", 40),
      ],
      series: [],
      sent: [],
    };
    const { calls, left, run } = harness(state, () => '{"series":[]}');

    expect(await run()).toEqual({ books: 105, series: 0 });

    const authors = calls.map((call) => [
      ...new Set(
        call.user
          .split("\n")
          .filter((line) => line.includes(" | "))
          .map((line) => line.split(" | ")[2]),
      ),
    ]);
    const sizes = calls.map(
      (call) => call.user.split("\n").filter((line) => line.includes(" | ")).length,
    );
    expect(authors).toEqual([["A"], ["B"], ["C"], ["D"], ["D"]]);
    expect(sizes).toEqual([20, 25, 20, 30, 10]);
    expect(left).toEqual([105, 85, 60, 40, 10]);
  });

  it("given two runs at once, has one request open at a time and sends each book once", async () => {
    const state: State = { books: tide, series: [], sent: [] };
    const { calls, open, run } = harness(state, tideReply);

    await Promise.all([run(), run()]);

    expect(calls).toHaveLength(1);
    expect(open.peak).toBe(1);
  });
});

describe("groupSeries, the request", () => {
  it("lists the series that exist and a card per book with the first 200 words of its text", async () => {
    const state: State = {
      books: [
        book("b1", "Beacon at Low Water", { series: "The Tide Cycle", seriesNumber: 1 }),
        book("b2", "The Quiet Shoal", { fileName: "the-quiet-shoal.epub" }),
        book("x", "Moss", { author: "J. Okafor", fileName: undefined }),
      ],
      series: [],
      sent: [],
    };
    const { calls, run } = harness(state, () => '{"series":[]}');

    await run();

    const [call] = calls;
    expect(call?.json).toBe(true);
    expect(call?.system.startsWith("Group these books into series.")).toBe(true);
    const lines = call?.user.split("\n") ?? [];
    expect(lines.slice(0, 5)).toEqual([
      "Series that exist:",
      "The Tide Cycle: #1 Beacon at Low Water (b1)",
      "",
      "Books:",
      "b2 | Moss | J. Okafor | ",
    ]);
    expect(lines[5]).toBe("b3 | The Quiet Shoal | R. Aster | the-quiet-shoal.epub");
    const words = (lines[6] ?? "").trim().split(" ");
    expect(words).toHaveLength(200);
    expect(words.slice(0, 7).join(" ")).toBe("THE QUIET SHOAL Book Two of The");
    expect(words[199]).toBe("w190");
  });
});

describe("groupSeries, the checks", () => {
  it("drops unknown keys, a second place for a book, bad numbers and markup in a name", async () => {
    const state: State = { books: tide, series: [], sent: [] };
    const { run } = harness(
      state,
      (user) =>
        `Here is the grouping:\n${JSON.stringify({
          series: [
            {
              name: '<img src=x onerror="alert(1)">The Tide\nCycle</b>',
              books: [
                { key: keyOf(user, "Beacon at Low Water"), number: -1 },
                { key: keyOf(user, "The Quiet Shoal"), number: "2" },
                { key: "b99", number: 3 },
                { key: keyOf(user, "Beacon at Low Water"), number: 1 },
                { key: keyOf(user, "Salt Memory"), number: 1000 },
                { key: keyOf(user, "The Deep Index"), number: "four" },
              ],
              possible: [{ key: keyOf(user, "The Quiet Shoal") }],
            },
            {
              name: "Stolen",
              books: [{ key: keyOf(user, "Salt Memory") }, { key: keyOf(user, "The Deep Index") }],
            },
            { name: "x".repeat(120), books: [{ key: "b98" }, { key: "b97" }] },
            { name: "<b></b>", books: [{ key: keyOf(user, "Salt Memory") }] },
          ],
        })}\nDone.`,
    );

    await run();

    expect(state.series).toEqual([
      new Series({
        id: "the tide cycle",
        name: "The Tide Cycle",
        books: [{ id: "b2", number: 2 }, { id: "b1" }, { id: "b3" }, { id: "b4" }],
        possible: [],
        removed: [],
      }),
    ]);
  });

  it("cuts a long name to 80 characters, and needs two books or one with a number", async () => {
    const state: State = {
      books: [...tide, book("h", "Harbor Lights", { author: "H. Dahl" })],
      series: [],
      sent: [],
    };
    const { run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          {
            name: `Tide ${"y".repeat(120)}`,
            books: [{ key: keyOf(user, "Salt Memory"), number: 7 }],
          },
          { name: "Alone", books: [{ key: keyOf(user, "Harbor Lights") }] },
          {
            name: "Unsure",
            books: [],
            possible: [
              { key: keyOf(user, "The Deep Index") },
              { key: keyOf(user, "Beacon at Low Water") },
            ],
          },
        ],
      }),
    );

    await run();

    expect(state.series.map((series) => [series.name.length, series.books])).toEqual([
      [80, [{ id: "b3", number: 7 }]],
    ]);
  });

  it("given a reply that is not JSON or empty, stores nothing and fails", async () => {
    for (const reply of ["I cannot group these.", "{ broken", "  "]) {
      const state: State = { books: tide, series: [], sent: [] };
      const { fail } = harness(state, () => reply);

      const error = await fail();

      expect(error).toBeInstanceOf(AiFailure);
      expect(state.series).toEqual([]);
      expect(state.sent).toEqual([]);
    }
  });
});

describe("groupSeries, the merge", () => {
  it("orders a new series by its numbers and stores it as the model's", async () => {
    const state: State = { books: tide, series: [], sent: [] };
    const { run } = harness(state, tideReply);

    expect(await run()).toEqual({ books: 4, series: 1 });

    expect(state.series[0]?.edited).toBeUndefined();
    expect(state.series[0]?.books).toEqual([
      { id: "b1", number: 1 },
      { id: "b2", number: 2 },
      { id: "b3", number: 3 },
      { id: "b4" },
    ]);
    expect(shown(state)).toEqual([["The Tide Cycle", ["b1", "b2", "b3", "b4"]]]);
  });

  it("puts a new book of the model's series before the first book with a higher number", async () => {
    const state: State = {
      books: tide,
      series: [
        record({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [
            { id: "b1", number: 1 },
            { id: "b3", number: 3 },
            { id: "b4", number: 4 },
          ],
        }),
      ],
      sent: ["b1", "b3", "b4"],
    };
    const { calls, run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          { name: "the tide cycle", books: [{ key: keyOf(user, "The Quiet Shoal"), number: 2 }] },
        ],
      }),
    );

    await run();

    expect(calls[0]?.user).toContain(
      "The Tide Cycle: #1 Beacon at Low Water (b1), #3 Salt Memory (b2), #4 The Deep Index (b3)",
    );
    expect(shown(state)).toEqual([["The Tide Cycle", ["b1", "b2", "b3", "b4"]]]);
  });

  it("keeps a saved series as it is and offers a new book only under Possible", async () => {
    const saved = record({
      id: "the tide cycle",
      name: "Tide Cycle",
      books: [{ id: "b3" }, { id: "b1" }],
      edited: true,
    });
    const state: State = { books: tide, series: [saved], sent: ["b1", "b3"] };
    const { run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          {
            name: "The Tide Cycle",
            books: [
              { key: keyOf(user, "The Quiet Shoal"), number: 2 },
              { key: "b1", number: 1 },
            ],
            possible: [{ key: keyOf(user, "The Deep Index"), number: 4 }],
          },
        ],
      }),
    );

    await run();

    expect(state.series).toEqual([
      new Series({
        ...saved,
        possible: [
          { id: "b2", number: 2 },
          { id: "b4", number: 4 },
        ],
      }),
    ]);
    expect(shown(state)).toEqual([["Tide Cycle", ["b3", "b1"]]]);
  });

  it("never adds back a removed book, also of a removed series, and never moves a book from a saved series", async () => {
    const state: State = {
      books: [...tide, book("h", "Harbor Lights"), book("l", "Lantern Keepers")],
      series: [
        record({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [{ id: "b1", number: 1 }],
          removed: ["b2"],
        }),
        record({ id: "harbor", name: "Harbor", removed: ["h"], hidden: true }),
        record({ id: "lights", name: "Lights", books: [{ id: "l" }, { id: "b4" }], edited: true }),
      ],
      sent: ["b1"],
    };
    const before = state.series.slice(1);
    const { run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          {
            name: "The Tide Cycle",
            books: [
              { key: keyOf(user, "The Quiet Shoal"), number: 2 },
              { key: keyOf(user, "Salt Memory"), number: 3 },
              { key: keyOf(user, "The Deep Index"), number: 4 },
            ],
          },
          { name: "HARBOR", books: [{ key: keyOf(user, "Harbor Lights"), number: 1 }] },
        ],
      }),
    );

    await run();

    expect(state.series.find((series) => series.id === "the tide cycle")?.books).toEqual([
      { id: "b1", number: 1 },
      { id: "b3", number: 3 },
    ]);
    expect(state.series.filter((series) => series.id !== "the tide cycle")).toEqual(before);
  });

  it("given a removed series, groups a new book under it again", async () => {
    const state: State = {
      books: [book("h", "Harbor Lights"), book("h2", "Harbor Nights")],
      series: [record({ id: "harbor", name: "Harbor", removed: ["h"], hidden: true })],
      sent: [],
    };
    const { run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          {
            name: "Harbor",
            books: [
              { key: keyOf(user, "Harbor Lights"), number: 1 },
              { key: keyOf(user, "Harbor Nights"), number: 2 },
            ],
          },
        ],
      }),
    );

    await run();

    expect(state.series[0]).toMatchObject({ books: [{ id: "h2", number: 2 }], hidden: false });
  });

  it("adds a book to a series from the EPUB fields under its name", async () => {
    const state: State = {
      books: [
        book("e1", "Lantern Keepers", { series: "Lighthouse Tales", seriesNumber: 1 }),
        book("e3", "The Last Lamp", { series: "Lighthouse Tales", seriesNumber: 3 }),
        book("p2", "The Middle Light"),
      ],
      series: [],
      sent: [],
    };
    const { run } = harness(state, (user) =>
      JSON.stringify({
        series: [
          {
            name: "Lighthouse Tales",
            books: [{ key: keyOf(user, "The Middle Light"), number: 2 }],
          },
        ],
      }),
    );

    await run();

    expect(shown(state)).toEqual([["Lighthouse Tales", ["e1", "p2", "e3"]]]);
  });
});
