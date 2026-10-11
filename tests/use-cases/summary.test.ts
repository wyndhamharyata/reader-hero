import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, CONSENT_VERSION, Summary, type AiMessage, type BookKind } from "@/domain/ai";
import {
  Block,
  BookMeta,
  BookPrefs,
  PARSED_VERSION,
  ParsedBook,
  ReadingProgress,
  Series,
  TocEntry,
} from "@/domain/book";
import { readingBadge } from "@/lib/badges";
import { decodeSummary } from "@/lib/codecs";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";
import { chapters, spanText } from "@/use-cases/ai-context";
import {
  coverage,
  describeSeries,
  earlierNames,
  describeSummary,
  mergeNames,
  pendingVolumes,
  seriesScope,
  summariseNext,
  summariseSeries,
  summaryFollowUp,
  type Coverage,
  type SummaryInput,
} from "@/use-cases/summary";
import { bookStore } from "../_support/book-store";
import { plain } from "../_support/prompt";

const meta = new BookMeta({
  id: "b1",
  title: "Treasure Island",
  author: "Stevenson",
  addedAt: 0,
  fileSize: 1,
  pageCount: 3,
  parseState: "ready",
  charCount: 40,
  format: "epub",
});

const settings = new AiSettings({
  provider: "deepseek",
  apiKey: "k",
  model: "flash",
  linesInContents: true,
  autoSummary: false,
  seriesGrouping: false,
});

const heading = (text: string, page: number): Block =>
  new Block({ kind: "heading", level: 1, text, page });
const paragraph = (text: string, page: number): Block =>
  new Block({ kind: "paragraph", level: 0, text, page });
// A paragraph of `count` words, so a chapter can pass the 200-word floor.
const filler = (count: number, page: number): Block =>
  paragraph(Array.from({ length: count }, (_, index) => `w${index}`).join(" "), page);

const book = (blocks: ReadonlyArray<Block>, toc: ReadonlyArray<TocEntry>): ParsedBook =>
  new ParsedBook({
    version: PARSED_VERSION,
    pageCount: 3,
    charCount: 40,
    blocks: [...blocks],
    toc: [...toc],
    figuresThrough: 0,
  });

const novel = book(
  [
    heading("Copyright", 1),
    paragraph("All rights reserved.", 1),
    heading("Chapter 1", 1),
    filler(300, 1),
    heading("Chapter 2", 2),
    filler(300, 2),
    heading("Chapter 3", 3),
    filler(300, 3),
  ],
  [
    new TocEntry({ title: "Copyright", page: 1, blockIndex: 0, depth: 0 }),
    new TocEntry({ title: "Chapter 1", page: 1, blockIndex: 2, depth: 0 }),
    new TocEntry({ title: "Chapter 2", page: 2, blockIndex: 4, depth: 0 }),
    new TocEntry({ title: "Chapter 3", page: 3, blockIndex: 6, depth: 0 }),
  ],
);
const list = chapters(novel);

const stored = (fields: Partial<Summary> = {}): Summary =>
  new Summary({
    bookId: "b1",
    model: "flash",
    updatedAt: 1,
    chapters: [
      { heading: "Chapter 1", page: 1, line: "One.", paragraph: "First." },
      { heading: "Chapter 2", page: 2, line: "Two.", paragraph: "Second." },
    ],
    names: [{ name: "Jim", note: "The narrator.", chapter: 1 }],
    namesThrough: 2,
    required: [],
    removed: [],
    thread: [],
    ...fields,
  });

interface Harness {
  readonly calls: Array<{ kind: string; system: string; user: string; json: boolean }>;
  readonly puts: Array<Summary>;
  readonly layer: Layer.Layer<AiClient | SummaryStore>;
}

// `during` changes the stored record as a request starts, as the reader would from the sheet.
function harness(
  initial: Summary | null,
  options: {
    readonly names?: string;
    readonly chapter?: string;
    readonly during?: (kind: string, current: Summary | null) => Summary | null;
  } = {},
): Harness {
  const calls: Harness["calls"] = [];
  const puts: Array<Summary> = [];
  let current = initial;
  const client = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (_settings, prompt, messages, request) => {
        const system = plain(prompt);
        const user = plain(messages[messages.length - 1]?.content ?? "");
        const kind = system.startsWith("You summarise one")
          ? "chapter"
          : system.startsWith("You summarise the part")
            ? "current"
            : "names";
        calls.push({ kind, system, user, json: request?.json === true });
        if (options.during !== undefined) current = options.during(kind, current);
        const count = calls.length;
        const reply =
          kind === "names"
            ? (options.names ??
              'Here it is: {"names":[{"name":"Jim","note":"The narrator.","first":1},{"name":"Pew","note":"Blind.","first":"9"},{"note":"no name"}]}')
            : kind === "current"
              ? `So far ${count}.`
              : (options.chapter ?? `One ${count}.\n\nParagraph ${count}.`);
        return Stream.fromArray([
          { type: "reasoning" as const, text: "hmm" },
          { type: "text" as const, text: reply.slice(0, 5) },
          { type: "text" as const, text: reply.slice(5) },
        ]);
      },
      models: () => Effect.succeed([]),
      balance: () => Effect.succeed(null),
    }),
  );
  const store = Layer.succeed(
    SummaryStore,
    SummaryStore.of({
      get: () => Effect.succeed(current),
      update: (_bookId, change) =>
        Effect.sync(() => {
          const next = change(current);
          if (next !== null) {
            current = next;
            puts.push(next);
          }
          return next;
        }),
      remove: () => Effect.void,
      changes: () => Stream.empty,
    }),
  );
  return { calls, puts, layer: Layer.mergeAll(client, store) };
}

describe("chapters", () => {
  it("given contents entries, drops the ones with under 200 words", () => {
    expect(list.map((chapter) => [chapter.heading, chapter.start, chapter.end])).toEqual([
      ["Chapter 1", 2, 4],
      ["Chapter 2", 4, 6],
      ["Chapter 3", 6, 8],
    ]);
  });

  it("given no contents, uses the heading blocks", () => {
    const bare = book(novel.blocks, []);
    expect(chapters(bare).map((chapter) => chapter.heading)).toEqual([
      "Chapter 1",
      "Chapter 2",
      "Chapter 3",
    ]);
  });

  it("given no contents and no headings, cuts pieces of 8,000 words named by page", () => {
    const long = book(
      Array.from({ length: 20 }, (_, index) => filler(1_000, index + 1)),
      [],
    );
    expect(chapters(long).map((chapter) => [chapter.heading, chapter.start, chapter.end])).toEqual([
      ["Page 1", 0, 8],
      ["Page 9", 8, 16],
      ["Page 17", 16, 20],
    ]);
  });

  it("given a figure in a span, leaves it out of the text", () => {
    const figure = new Block({ kind: "image", level: 0, text: "", page: 1, imageId: "1-0" });
    const parsed = book([paragraph("one", 1), figure, paragraph("two", 1)], []);
    expect(spanText(parsed, 0, 3)).toBe("one\n\ntwo");
  });
});

describe("coverage", () => {
  it("given a story, counts the chapters before the position and the one being read", () => {
    const cover = coverage(list, novel, "story", 7);
    expect(cover.target).toBe(2);
    expect(cover.current?.chapter.heading).toBe("Chapter 3");
    expect(cover.current?.end).toBe(8);
    expect(cover.current?.text.startsWith("Chapter 3\n\nw0 w1")).toBe(true);
  });

  it("given a chapter's first block alone, offers no entry for it yet", () => {
    expect(coverage(list, novel, "story", 6).current).toBeNull();
  });

  it("given a reference document, covers every section and reads none to here", () => {
    expect(coverage(list, novel, "reference", 3)).toEqual({ target: 3, current: null });
  });

  it("given the end of a Finished book, covers every chapter", () => {
    expect(coverage(list, novel, "story", novel.blocks.length)).toEqual({
      target: list.length,
      current: null,
    });
  });
});

describe("summariseNext", () => {
  it("given two unsummarised chapters, sends each once, then the names merge and the part read", async () => {
    const { calls, puts, layer } = harness(null);
    const progress: Array<string> = [];
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, (run) =>
        Effect.sync(() => progress.push(`${run.stage} ${run.chapter} ${run.text}`)),
      ).pipe(Effect.provide(layer)),
    );

    expect(calls.map((call) => [call.kind, call.json])).toEqual([
      ["chapter", false],
      ["chapter", false],
      ["names", true],
      ["current", false],
    ]);
    expect(calls[0]?.user).toContain("Heading: Chapter 1.");
    expect(calls[0]?.user).not.toContain("Previous chapter");
    expect(calls[1]?.user).toContain("Previous chapter's summary:\nParagraph 1.");
    expect(calls[2]?.user).toContain("#2 Chapter 2\nParagraph 2.");
    expect(calls[3]?.user).toContain("Heading: Chapter 3, up to where the reader stopped.");
    expect(calls[3]?.user).toContain("Previous chapter's summary:\nParagraph 2.");
    expect(puts).toHaveLength(4);
    expect(puts[0]?.chapters).toHaveLength(1);
    expect(
      result.chapters.map((chapter) => [chapter.heading, chapter.line, chapter.paragraph]),
    ).toEqual([
      ["Chapter 1", "One 1.", "Paragraph 1."],
      ["Chapter 2", "One 2.", "Paragraph 2."],
    ]);
    expect(result.names).toEqual([
      { name: "Jim", note: "The narrator.", chapter: 1 },
      { name: "Pew", note: "Blind.", chapter: 2 },
    ]);
    expect(result.namesThrough).toBe(2);
    expect(result.current).toEqual({ heading: "Chapter 3", end: 8, text: "So far 4." });
    expect(progress[0]).toBe("chapter 1 ");
    expect(progress).toContain("chapter 1 One 1.\n\nParagraph 1.");
    expect(progress.at(-1)).toBe("current 3 So far 4.");
  });

  it("given a current summary with an added name, sends the names merge alone", async () => {
    const fresh = stored({
      required: ["Ben Gunn"],
      current: { heading: "Chapter 3", end: 8, text: "So far." },
    });
    const { calls, layer } = harness(fresh);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls.map((call) => call.kind)).toEqual(["names"]);
    expect(calls[0]?.user).toContain("Entries the reader asked for: Ben Gunn");
    expect(calls[0]?.user).toContain("New chapters:\n\nReturn the merged list.");
  });

  it("given what earlier books told of their characters, sends it with the names merge of a story only", async () => {
    const earlier = [{ name: "Silver", note: "The cook who led the mutiny." }];
    const merge = async (kind: BookKind) => {
      const { calls, layer } = harness(stored({ required: ["Ben Gunn"] }));
      await Effect.runPromise(
        summariseNext(
          { meta, parsed: novel, kind, index: 6, earlier },
          settings,
          () => Effect.void,
        ).pipe(Effect.provide(layer)),
      );
      return calls.find((call) => call.kind === "names");
    };

    const story = await merge("story");
    const document = await merge("reference");

    expect(story?.system).toContain("This book continues a series");
    expect(story?.system).toContain("A note is at most 25 words");
    expect(story?.user).toContain(
      'Known from earlier books (JSON):\n[{"name":"Silver","note":"The cook who led the mutiny."}]',
    );
    expect(document?.system).not.toContain("continues a series");
    expect(document?.user).not.toContain("Known from earlier books");
  });

  it("given earlier books, keeps only the characters this book's summaries name", async () => {
    const record = stored({
      chapters: [
        { heading: "Chapter 1", page: 1, line: "One.", paragraph: "Jim meets Dr. Livesey." },
        { heading: "Chapter 2", page: 2, line: "Two.", paragraph: "Ben waits on the island." },
      ],
      names: [],
      namesThrough: 0,
      required: ["Long John"],
    });
    const reply = JSON.stringify({
      names: [
        { name: "Jim Hawkins", note: "The narrator.", first: 1 },
        { name: "Dr. Livesey", note: "The doctor.", first: 1 },
        { name: "Ben Gunn", note: "A castaway.", first: 2 },
        { name: "Long John", note: "Asked for.", first: 2 },
        { name: "Mr. Silver", note: "From the first book.", first: 1 },
        { name: "Pew", note: "From the first book.", first: 1 },
      ],
    });
    const merge = async (earlier: SummaryInput["earlier"]) => {
      const { layer } = harness(record, { names: reply });
      const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 6, earlier };
      const result = await Effect.runPromise(
        mergeNames(input, record, 2, settings).pipe(Effect.provide(layer)),
      );
      return result.names.map((entry) => entry.name);
    };

    expect(await merge([{ name: "Pew", note: "Blind." }])).toEqual([
      "Jim Hawkins",
      "Dr. Livesey",
      "Ben Gunn",
      "Long John",
    ]);
    expect(await merge(undefined)).toHaveLength(6);
  });

  it("given names after the boundary, does not send or remove them during an update", async () => {
    const later = { name: "Silver", note: "Appears later.", chapter: 2 };
    const summary = stored({
      names: [{ name: "Jim", note: "The narrator.", chapter: 1 }, later],
      namesThrough: 2,
      required: ["Ben Gunn"],
    });
    const { calls, layer } = harness(summary);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 4 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls[0]?.user).not.toContain("Silver");
    expect(result.names).toContainEqual(later);
  });

  it("given edited and removed entries, the merge keeps the edits and leaves the removed out", async () => {
    const curated = stored({
      names: [
        { name: "Jim", note: "The narrator.", chapter: 1 },
        { name: "Pew", note: "Blind, and rides down the road.", chapter: 2, edited: true },
      ],
      namesThrough: 1,
      removed: ["Jim"],
      current: { heading: "Chapter 3", end: 8, text: "So far." },
    });
    const { calls, layer } = harness(curated);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls.map((call) => call.kind)).toEqual(["names"]);
    expect(calls[0]?.user).toContain("Entries the reader edited, to keep as written: Pew");
    expect(calls[0]?.user).toContain("Entries the reader removed, to leave out: Jim");
    expect(result.names).toEqual([
      { name: "Pew", note: "Blind, and rides down the road.", chapter: 2, edited: true },
    ]);
  });

  it("given a position that moved on, remakes only the part of the chapter read", async () => {
    const moved = stored({ current: { heading: "Chapter 3", end: 7, text: "Earlier." } });
    const { calls, puts, layer } = harness(moved);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls.map((call) => call.kind)).toEqual(["current"]);
    expect(puts).toHaveLength(1);
    expect(result.current?.end).toBe(8);
  });

  it("given a names reply that is not JSON, fails after the chapters are stored", async () => {
    const { puts, layer } = harness(null, { names: "Sorry, no." });
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 4 };

    const exit = await Effect.runPromiseExit(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.namesThrough).toBe(0);
  });

  it("given edits while a chapter streams, keeps them through the job's writes", async () => {
    const edited = { name: "Jim", note: "Mine.", chapter: 1, edited: true };
    const { puts, layer } = harness(
      stored({ chapters: stored().chapters.slice(0, 1), namesThrough: 1 }),
      {
        during: (kind, current) =>
          kind === "chapter" && current !== null
            ? new Summary({ ...current, names: [edited], required: ["Ben Gunn"] })
            : kind === "names" && current !== null
              ? new Summary({ ...current, required: [...current.required, "Silver"] })
              : current,
      },
    );
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(puts[0]?.chapters).toHaveLength(2);
    expect(puts[0]?.names).toEqual([edited]);
    expect(puts[0]?.required).toEqual(["Ben Gunn"]);
    expect(result.names[0]).toEqual(edited);
    expect(result.required).toEqual(["Silver"]);
  });

  it("given a prologue first, labels each chapter by its heading, not by a number", async () => {
    const prologue = book(
      [heading("Prologue", 1), filler(300, 1), heading("Chapter 1", 2), filler(300, 2)],
      [
        new TocEntry({ title: "Prologue", page: 1, blockIndex: 0, depth: 0 }),
        new TocEntry({ title: "Chapter 1", page: 2, blockIndex: 2, depth: 0 }),
      ],
    );
    const { calls, layer } = harness(null);
    const input: SummaryInput = { meta, parsed: prologue, kind: "story", index: 4 };

    await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls[0]?.user).toContain("Heading: Prologue.");
    expect(calls[1]?.user).toContain("Heading: Chapter 1.");
    expect(calls[2]?.user).toContain("#1 Prologue\nParagraph 1.\n\n#2 Chapter 1\nParagraph 2.");
    const sent = calls.map((call) => call.user).join("\n");
    expect(sent).not.toContain("chapter 1:");
    expect(sent).not.toContain("chapter 2:");
  });

  it("given an empty reply, fails and stores no chapter", async () => {
    const { puts, layer } = harness(null, { chapter: "  \n" });
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 4 };

    const exit = await Effect.runPromiseExit(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(puts).toHaveLength(0);
  });
});

describe("summaryFollowUp", () => {
  it("given a summary discarded while the answer streams, writes nothing back", async () => {
    const { puts, layer } = harness(null);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 7 };

    const result = await Effect.runPromise(
      summaryFollowUp(input, settings, stored(), "Who is Jim?", () => undefined).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it("given a boundary before stored summaries, sends only chapters inside it", async () => {
    const summary = stored({
      names: [
        { name: "Jim", note: "The narrator.", chapter: 1 },
        { name: "Ben", note: "Appears later.", chapter: 2 },
      ],
    });
    const { calls, layer } = harness(summary);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", index: 4 };

    await Effect.runPromise(
      summaryFollowUp(input, settings, summary, "Who is Jim?", () => undefined).pipe(
        Effect.provide(layer),
      ),
    );

    expect(calls[0]?.system).toContain("Chapter 1\nFirst.");
    expect(calls[0]?.system).not.toContain("Chapter 2\nSecond.");
    expect(calls[0]?.system).not.toContain("Ben: Appears later.");
  });
});

describe("describeSummary", () => {
  const five = stored({
    chapters: Array.from({ length: 5 }, (_, index) => ({
      heading: `Chapter ${index + 1}`,
      page: 1,
      line: "",
      paragraph: "",
    })),
    namesThrough: 5,
  });
  const chapter8 = { heading: "Chapter 8", page: 1, start: 0, end: 0 };
  const plain: Coverage = { target: 7, current: null };
  const reading: Coverage = { target: 7, current: { chapter: chapter8, end: 50, text: "" } };

  it("given a boundary before stored summaries, counts only chapters inside it", () => {
    expect(describeSummary(five, { target: 1, current: null }, null, "story")).toEqual({
      row: "1 chapter",
      action: null,
    });
  });

  it("given each coverage, names the row and the one action", () => {
    expect(describeSummary(null, plain, null, "story")).toEqual({
      row: "None",
      action: "Summarise 7 chapters",
    });
    expect(describeSummary(five, plain, null, "story")).toEqual({
      row: "5 chapters · 2 pending",
      action: "Summarise 2 chapters",
    });
    expect(describeSummary(five, { ...plain, target: 6 }, null, "story").action).toBe(
      "Summarise 1 chapter",
    );
    expect(describeSummary(five, reading, null, "story").action).toBe(
      "Summarise 2 chapters and current position",
    );
    expect(describeSummary(five, { ...plain, target: 5 }, null, "story")).toEqual({
      row: "5 chapters",
      action: null,
    });
    expect(describeSummary(five, { ...plain, target: 5 }, null, "reference").row).toBe(
      "5 sections",
    );
  });

  it("given the chapter being read, offers its current position, then an update after a move", () => {
    const seven = stored({
      chapters: Array.from({ length: 7 }, (_, index) => ({
        heading: `Chapter ${index + 1}`,
        page: 1,
        line: "",
        paragraph: "",
      })),
      namesThrough: 7,
    });
    expect(describeSummary(seven, reading, null, "story").action).toBe(
      "Summarise current position",
    );
    const made = new Summary({ ...seven, current: { heading: "Chapter 8", end: 40, text: "x" } });
    expect(describeSummary(made, reading, null, "story").action).toBe("Update current position");
    const fresh = new Summary({ ...seven, current: { heading: "Chapter 8", end: 50, text: "x" } });
    expect(describeSummary(fresh, reading, null, "story").action).toBeNull();
  });

  it("given a run, names its stage", () => {
    expect(
      describeSummary(five, plain, { stage: "chapter", chapter: 6, of: 7, text: "" }, "story").row,
    ).toBe("2 chapters left");
    expect(
      describeSummary(five, plain, { stage: "chapter", chapter: 7, of: 7, text: "" }, "story").row,
    ).toBe("1 chapter left");
    expect(
      describeSummary(five, plain, { stage: "current", chapter: 8, of: 7, text: "" }, "story").row,
    ).toBe("Current position");
    expect(
      describeSummary(five, plain, { stage: "names", chapter: 7, of: 7, text: "" }, "story").row,
    ).toBe("Updating characters");
  });

  it("given names behind the chapters or an added name, offers the update", () => {
    const lagging = new Summary({ ...five, namesThrough: 3 });
    expect(describeSummary(lagging, { ...plain, target: 5 }, null, "story").action).toBe(
      "Update characters",
    );
    const added = new Summary({ ...five, required: ["Ben Gunn"] });
    expect(describeSummary(added, { ...plain, target: 5 }, null, "reference").action).toBe(
      "Update terms",
    );
  });
});

const volume = (id: string, title: string): BookMeta =>
  new BookMeta({
    id,
    title,
    author: "R. Aster",
    addedAt: 0,
    fileSize: 1,
    pageCount: 3,
    parseState: "ready",
    charCount: 40,
    format: "epub",
  });
const beacon = volume("b1", "Beacon at Low Water");
const shoal = volume("b2", "The Quiet Shoal");
const salt = volume("b3", "Salt Memory");
const deep = volume("b4", "The Deep Index");

const card = (meta: BookMeta, status: LibraryCard["status"]): LibraryCard => ({
  book: meta,
  percent: status === "finished" ? 1 : status === "reading" ? 0.5 : 0,
  status,
  badge: readingBadge[status],
  clipStart: false,
});

// The stored Summary of one volume: `count` chapter summaries, each named after its book.
const kept = (bookId: string, prefix: string, count: number, fields: Partial<Summary> = {}) =>
  new Summary({
    bookId,
    model: "flash",
    updatedAt: 1,
    chapters: ["first", "second", "third"].slice(0, count).map((word, index) => ({
      heading: `Chapter ${index + 1}`,
      page: index + 1,
      line: "",
      paragraph: `${prefix} ${word}.`,
    })),
    names: [],
    namesThrough: count,
    required: [],
    removed: [],
    thread: [],
    ...fields,
  });

const reading = (blockIndex: number): ReadingProgress =>
  new ReadingProgress({ blockIndex, percent: 0.5, updatedAt: 1, furthest: blockIndex });

interface SeriesState {
  readonly summaries: Map<string, Summary>;
  readonly books?: ReadonlyArray<BookMeta>;
  readonly series?: ReadonlyArray<Series>;
  readonly progress?: ReadonlyMap<string, ReadingProgress>;
  readonly kinds?: ReadonlyMap<string, BookKind>;
  readonly reply?: string;
}

// The stores over plain maps; `reads` lists each book whose text was read.
function seriesHarness(state: SeriesState) {
  const calls: Array<{ kind: string; system: string; user: string }> = [];
  const reads: Array<string> = [];
  const client = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (_settings, prompt, messages) => {
        const system = plain(prompt);
        const user = plain(messages[messages.length - 1]?.content ?? "");
        const kind = system.startsWith("Summarise one book of a series")
          ? "series"
          : system.startsWith("You summarise one")
            ? "chapter"
            : system.startsWith("You summarise the part")
              ? "current"
              : "names";
        calls.push({ kind, system, user });
        const count = calls.length;
        const reply =
          kind === "series"
            ? (state.reply ?? `Paragraph ${count}.`)
            : kind === "current"
              ? `So far ${count}.`
              : kind === "names"
                ? '{"names":[]}'
                : `One ${count}.\n\nParagraph ${count}.`;
        return Stream.fromArray([{ type: "text" as const, text: reply }]);
      },
      models: () => Effect.succeed([]),
      balance: () => Effect.succeed(null),
    }),
  );
  const store = Layer.succeed(
    SummaryStore,
    SummaryStore.of({
      get: (bookId) => Effect.sync(() => state.summaries.get(bookId) ?? null),
      update: (bookId, change) =>
        Effect.sync(() => {
          const next = change(state.summaries.get(bookId) ?? null);
          if (next !== null) state.summaries.set(bookId, next);
          return next;
        }),
      remove: (bookId) =>
        Effect.sync(() => {
          state.summaries.delete(bookId);
        }),
      changes: () => Stream.empty,
    }),
  );
  const books = bookStore({
    list: () => Effect.succeed(state.books ?? []),
    listSeries: () => Effect.succeed(state.series ?? []),
    getParsed: (id) =>
      Effect.sync(() => {
        reads.push(id);
        return novel;
      }),
    getProgress: (id) => Effect.succeed(state.progress?.get(id) ?? null),
    getPrefs: (id) => Effect.succeed(new BookPrefs({ kind: state.kinds?.get(id) ?? "story" })),
  });
  return { calls, reads, layer: Layer.mergeAll(client, store, books) };
}

const tide = (cards: ReadonlyArray<LibraryCard>): Shelf["series"][number] => ({
  kind: "series",
  id: "the tide cycle",
  name: "The Tide Cycle",
  books: cards,
  inProgress: null,
  count: cards.length,
  finishedCount: 0,
  status: "reading",
  color: 250,
});

// The rows before and after one tap of Summarise in Salt Memory, the series' current book.
async function tap(cards: ReadonlyArray<LibraryCard>, state: SeriesState) {
  const { calls, reads, layer } = seriesHarness(state);
  const series = tide(cards);
  const scope = await Effect.runPromise(seriesScope(series, "b3").pipe(Effect.provide(layer)));
  const rows = () =>
    describeSeries(
      scope,
      new Map(cards.map((entry) => [entry.book.id, state.summaries.get(entry.book.id) ?? null])),
      null,
    );
  const before = rows();
  const sentBefore = calls.length;
  const exit = await Effect.runPromiseExit(
    summariseSeries(series, "b3", settings, () => Effect.void).pipe(Effect.provide(layer)),
  );
  return { before, sentBefore, exit, after: rows(), calls, reads, rows };
}

describe("series summary boundary", () => {
  it("given an earlier Finished volume, writes its missing chapters, then sends every chapter summary", async () => {
    const state = { summaries: new Map([["b1", kept("b1", "V1", 1)]]) };
    const { before, after, calls } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[0]).toEqual({ scope: "2 chapters pending", text: null });
    expect(before.action).toBe("Summarise 1 volume");
    expect(calls.map((call) => call.kind)).toEqual(["chapter", "chapter", "series"]);
    expect(calls[0]?.user).toContain("Book: Beacon at Low Water by R. Aster.\nHeading: Chapter 2.");
    expect(calls[2]?.user).toContain(
      "Chapter 1\nV1 first.\n\nChapter 2\nParagraph 1.\n\nChapter 3\nParagraph 2.",
    );
    expect(after.rows[0]).toEqual({ scope: null, text: "Paragraph 3." });
    expect(after.action).toBeNull();
  });

  it("given an earlier volume being read, sends the summaries before its furthest position and its current text", async () => {
    const state = {
      summaries: new Map([["b1", kept("b1", "V1", 3)]]),
      progress: new Map([["b1", reading(7)]]),
    };
    const { before, after, calls } = await tap(
      [
        card(beacon, "reading"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[0]).toEqual({ scope: "1 pending", text: null });
    expect(calls.map((call) => call.kind)).toEqual(["current", "series"]);
    expect(calls[1]?.user).toContain(
      "Chapter 1\nV1 first.\n\nChapter 2\nV1 second.\n\nChapter 3, up to where the reader stopped\nSo far 1.",
    );
    expect(calls[1]?.user).not.toContain("V1 third.");
    expect(after.rows[0]).toEqual({ scope: null, text: "Paragraph 2." });
    expect(state.summaries.get("b1")?.volume).toMatchObject({ chapters: 2, current: 8 });
  });

  it("given an earlier volume not started, sends nothing and reads none of its text", async () => {
    const { before, calls, reads } = await tap(
      [
        card(beacon, "not-started"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      { summaries: new Map() },
    );

    expect(before.rows.map((row) => row.scope)).toEqual([null, null, null, null]);
    expect(before.action).toBeNull();
    expect(calls).toEqual([]);
    // Only the current book's text is read, for its own Summary in its row.
    expect(reads.filter((id) => id !== "b3")).toEqual([]);
  });

  it("given an earlier document, sends every section, as its own Summary does", async () => {
    const state = {
      summaries: new Map([["b1", kept("b1", "V1", 3)]]),
      progress: new Map([["b1", reading(3)]]),
      kinds: new Map<string, BookKind>([["b1", "reference"]]),
    };
    const { before, calls } = await tap(
      [
        card(beacon, "reading"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[0]?.scope).toBe("1 pending");
    expect(calls.map((call) => call.kind)).toEqual(["series"]);
    expect(calls[0]?.user).toContain(
      "Section summaries:\nChapter 1\nV1 first.\n\nChapter 2\nV1 second.\n\nChapter 3\nV1 third.",
    );
  });

  it("given the current book and a later Finished one, writes the current one's paragraph and keeps the later one's", async () => {
    const state = {
      summaries: new Map([
        ["b1", kept("b1", "V1", 3)],
        ["b3", kept("b3", "V3", 3)],
        [
          "b4",
          kept("b4", "V4", 3, {
            volume: { text: "V4 paragraph.", chapters: 3, model: "flash", updatedAt: 1 },
          }),
        ],
      ]),
    };
    const { before, after, calls, reads } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "not-started"),
        card(salt, "finished"),
        card(deep, "finished"),
      ],
      state,
    );

    expect(before.rows[2]).toEqual({ scope: "1 pending", text: null });
    expect(before.rows[3]).toEqual({ scope: null, text: "V4 paragraph." });
    expect(before.action).toBe("Summarise 2 volumes");
    expect(calls.map((call) => call.kind)).toEqual(["series", "series"]);
    expect(calls[1]?.user).toContain("Series: The Tide Cycle, book 3 of 4.");
    expect(calls[1]?.user).toContain("Book 1, Beacon at Low Water: Paragraph 1.");
    expect(calls[1]?.user).toContain("Chapter 3\nV3 third.");
    expect(calls.map((call) => call.user).join("\n")).not.toContain("V4");
    expect(after.rows.map((row) => row.text)).toEqual([
      "Paragraph 1.",
      null,
      "Paragraph 2.",
      "V4 paragraph.",
    ]);
    expect(after.action).toBeNull();
    expect(new Set(reads)).toEqual(new Set(["b1", "b3", "b4"]));
  });

  it("given Finished turned off, hides the paragraph past the new boundary and sends only what is inside it", async () => {
    const state = {
      summaries: new Map([
        [
          "b1",
          kept("b1", "V1", 3, {
            volume: { text: "The whole book.", chapters: 3, model: "flash", updatedAt: 1 },
          }),
        ],
      ]),
      progress: new Map([["b1", reading(5)]]),
    };
    const { before, after, calls } = await tap(
      [
        card(beacon, "reading"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[0]).toEqual({ scope: "1 pending", text: null });
    expect(before.action).toBe("Summarise 1 volume");
    expect(calls.map((call) => call.kind)).toEqual(["current", "series"]);
    expect(calls[1]?.user).toContain(
      "Chapter 1\nV1 first.\n\nChapter 2, up to where the reader stopped\nSo far 1.",
    );
    expect(calls[1]?.user).not.toContain("V1 second.");
    expect(calls[1]?.user).not.toContain("V1 third.");
    expect(calls[1]?.user).not.toContain("The whole book.");
    expect(after.rows[0]?.text).toBe("Paragraph 2.");
  });

  it("given a volume moved after the current book, shows its paragraph and sends none of its text", async () => {
    const paragraph = { text: "V1 paragraph.", chapters: 3, model: "flash", updatedAt: 1 };
    const state = {
      summaries: new Map([
        ["b1", kept("b1", "V1", 3, { volume: paragraph })],
        ["b2", kept("b2", "V2", 3)],
      ]),
    };
    const { before, calls } = await tap(
      [
        card(shoal, "finished"),
        card(salt, "reading"),
        card(beacon, "finished"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[2]).toEqual({ scope: null, text: "V1 paragraph." });
    expect(calls.map((call) => call.kind)).toEqual(["series"]);
    expect(calls[0]?.user).toContain("Series: The Tide Cycle, book 1 of 4.");
    expect(calls[0]?.user).not.toContain("Beacon at Low Water");
    expect(calls[0]?.user).not.toContain("V1");
    expect(state.summaries.get("b1")?.volume).toEqual(paragraph);
  });
});

describe("series summary", () => {
  it("given two earlier volumes, sends one request each with the volume before, by heading", async () => {
    const state = {
      summaries: new Map([
        [
          "b1",
          kept("b1", "V1", 3, {
            volume: { text: "V1 paragraph.", chapters: 3, model: "flash", updatedAt: 1 },
          }),
        ],
        ["b2", kept("b2", "V2", 3)],
      ]),
    };
    const { calls, after } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "finished"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(calls.map((call) => call.kind)).toEqual(["series"]);
    expect(calls[0]?.system).toBe(
      "Summarise one book of a series from its chapter summaries. Use only the text given. Write one paragraph, at most 150 words, in the past tense. No headings, lists, predictions, opinions or questions. Write in the language of the summaries.",
    );
    expect(calls[0]?.user).toBe(
      [
        "Series: The Tide Cycle, book 2 of 4.",
        "Book: The Quiet Shoal by R. Aster.",
        "Book 1, Beacon at Low Water: V1 paragraph.",
        "",
        "Chapter summaries:",
        "Chapter 1",
        "V2 first.",
        "",
        "Chapter 2",
        "V2 second.",
        "",
        "Chapter 3",
        "V2 third.",
      ].join("\n"),
    );
    expect(calls[0]?.user).not.toContain("#");
    expect(after.rows.map((row) => row.text)).toEqual([
      "V1 paragraph.",
      "Paragraph 1.",
      null,
      null,
    ]);
  });

  it("given a reply, stores it on that book's own record and on no other", async () => {
    const state = { summaries: new Map([["b2", kept("b2", "V2", 3)]]) };
    await tap(
      [
        card(beacon, "not-started"),
        card(shoal, "finished"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(state.summaries.get("b2")?.volume).toMatchObject({
      text: "Paragraph 1.",
      chapters: 3,
      current: undefined,
      model: "flash",
    });
    expect(state.summaries.get("b2")?.chapters).toEqual(kept("b2", "V2", 3).chapters);
    expect([...state.summaries.keys()]).toEqual(["b2"]);
  });

  it("given more chapters read since the paragraph, shows it and marks the volume pending", async () => {
    const state = {
      summaries: new Map([
        [
          "b1",
          kept("b1", "V1", 2, {
            volume: { text: "V1 so far.", chapters: 1, model: "flash", updatedAt: 1 },
          }),
        ],
      ]),
      progress: new Map([["b1", reading(6)]]),
    };
    const { before, calls } = await tap(
      [
        card(beacon, "reading"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(before.rows[0]).toEqual({
      scope: "1 pending",
      text: "V1 so far.",
    });
    expect(before.action).toBe("Update 1 volume");
    expect(calls.map((call) => call.kind)).toEqual(["series"]);
    expect(state.summaries.get("b1")?.volume?.chapters).toBe(2);
  });

  it("given an empty reply, stores nothing and fails for Retry", async () => {
    const state = { summaries: new Map([["b1", kept("b1", "V1", 3)]]), reply: " \n" };
    const { exit, after } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );

    expect(exit._tag).toBe("Failure");
    expect(state.summaries.get("b1")?.volume).toBeUndefined();
    expect(after.rows[0]).toEqual({ scope: "1 pending", text: null });
  });

  it("given Discard on a volume's Summary, removes its paragraph with it", async () => {
    const state = { summaries: new Map([["b1", kept("b1", "V1", 3)]]) };
    const { after, rows } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "not-started"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      state,
    );
    expect(after.rows[0]?.text).toBe("Paragraph 1.");

    state.summaries.delete("b1");

    expect(rows().rows[0]).toEqual({ scope: "3 chapters pending", text: null });
    expect(rows().action).toBe("Summarise 1 volume");
  });

  it("given a record from an older build, decodes it with no paragraph", async () => {
    const { volume: _volume, ...older } = kept("b1", "V1", 1);
    const decoded = await Effect.runPromise(decodeSummary(JSON.parse(JSON.stringify(older))));
    expect(decoded.volume).toBeUndefined();
    expect(decoded.chapters).toHaveLength(1);
  });

  it("given a run, names its volume and stage in the Summary's words, with no ellipsis", async () => {
    const scope = await Effect.runPromise(
      seriesScope(
        tide([card(beacon, "finished"), card(shoal, "finished"), card(salt, "reading")]),
        "b3",
      ).pipe(Effect.provide(seriesHarness({ summaries: new Map() }).layer)),
    );
    const status = (run: Parameters<typeof describeSeries>[2]) =>
      describeSeries(scope, new Map(), run).status;

    expect(describeSeries(scope, new Map(), null).action).toBe("Summarise 2 volumes");
    expect(status(null)).toBeNull();
    expect(status({ stage: "chapter", chapter: 0, of: 0, text: "" })).toBe("Starting");
    expect(status({ stage: "chapter", chapter: 7, of: 15, text: "", book: "b2" })).toBe(
      "The Quiet Shoal · 9 chapters left",
    );
    expect(status({ stage: "current", chapter: 3, of: 2, text: "", book: "b2" })).toBe(
      "The Quiet Shoal · Current position",
    );
    expect(status({ stage: "volume", chapter: 3, of: 3, text: "", book: "b2" })).toBe(
      "The Quiet Shoal · Series summary",
    );
    expect(
      describeSeries(scope, new Map(), {
        stage: "volume",
        chapter: 3,
        of: 3,
        text: "So",
        book: "b2",
      }).rows[1]?.text,
    ).toBe("So");
  });
});

describe("series summary requests", () => {
  it("given the sheet's rows, sends nothing before a tap", async () => {
    const { sentBefore } = await tap(
      [
        card(beacon, "finished"),
        card(shoal, "finished"),
        card(salt, "reading"),
        card(deep, "not-started"),
      ],
      { summaries: new Map() },
    );
    expect(sentBefore).toBe(0);
  });

  it("given the Summary's own job, as Automatic summary starts it, sends no series request", async () => {
    const { calls, layer } = seriesHarness({ summaries: new Map() });
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* SummaryJobs;
        yield* jobs.start({ meta: salt, parsed: novel, kind: "story", index: 7 }, settings);
        yield* jobs.state(salt.id).pipe(
          Stream.filter((state) => state.run === null),
          Stream.runHead,
        );
      }).pipe(Effect.provide(SummaryJobs.layer.pipe(Layer.provide(layer)))),
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.kind === "series")).toBe(false);
  });

  it("given a series run that holds a volume, starts no job of that volume beside it", async () => {
    const { calls, layer } = seriesHarness({ summaries: new Map([["b1", kept("b1", "V1", 1)]]) });
    const series = tide([card(beacon, "finished"), card(salt, "reading")]);
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* SummaryJobs;
        yield* jobs.startSeries(series, "b3", settings);
        yield* jobs.start({ meta: beacon, parsed: novel, kind: "story", index: 8 }, settings);
        yield* jobs.state(`series:${series.id}`).pipe(
          Stream.filter((state) => state.run === null),
          Stream.runHead,
        );
      }).pipe(Effect.provide(SummaryJobs.layer.pipe(Layer.provide(layer)))),
    );

    expect(calls.map((call) => call.kind)).toEqual(["chapter", "chapter", "series"]);
  });
});

describe("earlier names", () => {
  const consented = new AiSettings({
    ...settings,
    consentedAt: 1,
    consentVersion: CONSENT_VERSION,
  });
  const summaries = () =>
    new Map([
      [
        "b1",
        kept("b1", "V1", 2, {
          names: [
            { name: "Jim", note: "A boy at an inn.", chapter: 1 },
            { name: "Silver", note: "Past the merged chapters.", chapter: 3 },
            { name: "Pew", note: "Blind, as the reader wrote.", chapter: 5, edited: true },
          ],
        }),
      ],
      [
        "b2",
        kept("b2", "V2", 2, { names: [{ name: "jim", note: "Now a ship's boy.", chapter: 1 }] }),
      ],
    ]);
  const series = tide([card(beacon, "finished"), card(shoal, "finished"), card(salt, "reading")]);
  const read = (input: SummaryInput, given: AiSettings) => {
    const { layer } = seriesHarness({ summaries: summaries() });
    return Effect.runPromise(earlierNames(series, input, given).pipe(Effect.provide(layer)));
  };

  it("given earlier volumes, keeps each name's newest note and only what their lists show", async () => {
    expect(await read({ meta: salt, parsed: novel, kind: "story", index: 7 }, consented)).toEqual([
      { name: "jim", note: "Now a ship's boy." },
      { name: "Pew", note: "Blind, as the reader wrote." },
    ]);
  });

  it("given an older consent, a document or the first volume, returns nothing", async () => {
    expect(await read({ meta: salt, parsed: novel, kind: "story", index: 7 }, settings)).toEqual(
      [],
    );
    expect(
      await read({ meta: salt, parsed: novel, kind: "reference", index: 7 }, consented),
    ).toEqual([]);
    expect(await read({ meta: beacon, parsed: novel, kind: "story", index: 7 }, consented)).toEqual(
      [],
    );
  });

  it("given a later volume's own job, sends the earlier names with its names merge", async () => {
    const { calls, layer } = seriesHarness({
      summaries: summaries(),
      books: [beacon, shoal, salt],
      series: [
        new Series({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
          possible: [],
          removed: [],
          edited: true,
        }),
      ],
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* SummaryJobs;
        yield* jobs.start({ meta: salt, parsed: novel, kind: "story", index: 7 }, consented);
        yield* jobs.state(salt.id).pipe(
          Stream.filter((state) => state.run === null),
          Stream.runHead,
        );
      }).pipe(Effect.provide(SummaryJobs.layer.pipe(Layer.provide(layer)))),
    );

    expect(calls.find((call) => call.kind === "names")?.user).toContain(
      'Known from earlier books (JSON):\n[{"name":"jim","note":"Now a ship\'s boy."},{"name":"Pew","note":"Blind, as the reader wrote."}]',
    );
  });
});

describe("rebuild", () => {
  const consented = new AiSettings({
    ...settings,
    consentedAt: 1,
    consentVersion: CONSENT_VERSION,
  });
  const done = new ReadingProgress({
    blockIndex: 8,
    percent: 1,
    updatedAt: 1,
    furthest: 8,
    finished: true,
  });
  const thread: Array<AiMessage> = [
    { role: "user", content: "Who is Jim?" },
    { role: "assistant", content: "The narrator." },
  ];
  const old = { text: "Old paragraph.", chapters: 3, model: "flash", updatedAt: 1 };

  it("given every summary, writes each again, series first volume to last, with edits kept and threads gone", async () => {
    const state = {
      summaries: new Map([
        [
          "b1",
          kept("b1", "V1", 3, {
            names: [
              { name: "Jim", note: "A boy at an inn.", chapter: 1 },
              { name: "Pew", note: "Blind, as the reader wrote.", chapter: 1, edited: true },
            ],
            thread,
            volume: old,
          }),
        ],
        ["b2", kept("b2", "V2", 3, { removed: ["Ben"], volume: old })],
        ["b4", kept("b4", "V4", 3, { thread })],
      ]),
      books: [beacon, shoal, salt, deep],
      series: [
        new Series({
          id: "the tide cycle",
          name: "The Tide Cycle",
          books: [{ id: "b1" }, { id: "b2" }],
          possible: [],
          removed: [],
          edited: true,
        }),
      ],
      progress: new Map([
        ["b1", done],
        ["b2", done],
        ["b3", reading(7)],
        ["b4", done],
      ]),
    };
    const { calls, layer } = seriesHarness(state);
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* SummaryJobs;
        yield* jobs.startRebuild(consented);
        yield* jobs.state("rebuild").pipe(
          Stream.filter((job) => job.run === null),
          Stream.runHead,
        );
      }).pipe(Effect.provide(SummaryJobs.layer.pipe(Layer.provide(layer)))),
    );

    const book = ["chapter", "chapter", "chapter", "names"];
    expect(calls.map((call) => call.kind)).toEqual([...book, "series", ...book, "series", ...book]);
    // The first chapter starts from nothing, not from the old summaries.
    expect(calls[0]?.user).not.toContain("V1");
    expect(calls[8]?.user).toContain(
      'Known from earlier books (JSON):\n[{"name":"Pew","note":"Blind, as the reader wrote."}]',
    );
    expect(calls[9]?.user).toContain("Series: The Tide Cycle, book 2 of 2.");
    expect(calls[9]?.user).toContain("Book 1, Beacon at Low Water: Paragraph 5.");
    expect(calls.map((call) => call.user).join("\n")).not.toContain("Old paragraph.");

    const b1 = state.summaries.get("b1");
    expect(b1?.chapters.map((chapter) => chapter.paragraph)).toEqual([
      "Paragraph 1.",
      "Paragraph 2.",
      "Paragraph 3.",
    ]);
    expect(b1?.names.map((entry) => entry.name)).toEqual(["Pew"]);
    expect(b1?.thread).toEqual([]);
    expect(b1?.volume?.text).toBe("Paragraph 5.");
    expect(state.summaries.get("b2")?.removed).toEqual(["Ben"]);
    expect(state.summaries.get("b4")?.thread).toEqual([]);
    expect(state.summaries.get("b4")?.volume).toBeUndefined();
    // A book alone that was never summarised stays so.
    expect(state.summaries.has("b3")).toBe(false);
  });

  it("given a volume with no paragraph, counts it, and on open counts only the volumes before the book", async () => {
    const state = {
      summaries: new Map([
        ["b1", kept("b1", "V1", 3, { volume: old })],
        ["b2", kept("b2", "V2", 3)],
      ]),
      progress: new Map([["b3", reading(7)]]),
    };
    const series = tide([card(beacon, "finished"), card(shoal, "finished"), card(salt, "reading")]);
    const { calls, layer } = seriesHarness(state);
    const count = (before?: string) =>
      Effect.runPromise(pendingVolumes(series, before).pipe(Effect.provide(layer)));

    expect(await count()).toBe(2);
    expect(await count("b3")).toBe(1);
    expect(await count("b1")).toBe(0);
    expect(calls).toEqual([]);
  });
});
