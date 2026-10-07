import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, Summary, type AiMessage } from "@/domain/ai";
import { Block, BookMeta, PARSED_VERSION, ParsedBook, TocEntry } from "@/domain/book";
import { AiClient } from "@/services/ai-client";
import { SummaryStore } from "@/services/summary-store";
import { chapters, spanText } from "@/use-cases/ai-context";
import {
  coverage,
  describeSummary,
  summariseNext,
  summaryFollowUp,
  type Coverage,
  type SummaryInput,
} from "@/use-cases/summary";

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
  readonly calls: Array<{ kind: string; user: string; json: boolean }>;
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
      complete: (_settings, system, messages: ReadonlyArray<AiMessage>, request) => {
        const user = messages[messages.length - 1]?.content ?? "";
        const kind = system.startsWith("You summarise one")
          ? "chapter"
          : system.startsWith("You summarise the part")
            ? "current"
            : "names";
        calls.push({ kind, user, json: request?.json === true });
        if (options.during !== undefined) current = options.during(kind, current);
        const count = calls.length;
        const reply =
          kind === "names"
            ? (options.names ??
              'Here it is: {"names":[{"name":"Jim","note":"The narrator.","chapter":1},{"name":"Pew","note":"Blind.","chapter":"9"},{"note":"no name"}]}')
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
    expect(calls[0]?.user).toContain("chapter 1: Chapter 1.");
    expect(calls[0]?.user).not.toContain("Previous chapter");
    expect(calls[1]?.user).toContain("Previous chapter's summary:\nParagraph 1.");
    expect(calls[2]?.user).toContain("chapter 2: Chapter 2\nParagraph 2.");
    expect(calls[3]?.user).toContain("chapter 3: Chapter 3, up to where the reader stopped.");
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

  it("given each coverage, names the row and the one action", () => {
    expect(describeSummary(null, plain, null, "story")).toEqual({
      row: "none",
      action: "Summarise chapters 1–7",
    });
    expect(describeSummary(five, plain, null, "story")).toEqual({
      row: "chapters 1–5 · 2 behind",
      action: "Summarise chapters 6–7",
    });
    expect(describeSummary(five, { ...plain, target: 6 }, null, "story").action).toBe(
      "Summarise chapter 6",
    );
    expect(describeSummary(five, reading, null, "story").action).toBe("Summarise chapters 6–8");
    expect(describeSummary(five, { ...plain, target: 5 }, null, "story")).toEqual({
      row: "chapters 1–5",
      action: null,
    });
    expect(describeSummary(five, { ...plain, target: 5 }, null, "reference").row).toBe(
      "sections 1–5",
    );
  });

  it("given the chapter being read, offers it to here, then an update after a move", () => {
    const seven = stored({
      chapters: Array.from({ length: 7 }, (_, index) => ({
        heading: `Chapter ${index + 1}`,
        page: 1,
        line: "",
        paragraph: "",
      })),
      namesThrough: 7,
    });
    expect(describeSummary(seven, reading, null, "story").action).toBe("Summarise to here");
    const made = new Summary({ ...seven, current: { heading: "Chapter 8", end: 40, text: "x" } });
    expect(describeSummary(made, reading, null, "story").action).toBe("Update to here");
    const fresh = new Summary({ ...seven, current: { heading: "Chapter 8", end: 50, text: "x" } });
    expect(describeSummary(fresh, reading, null, "story").action).toBeNull();
  });

  it("given a run, names its stage", () => {
    expect(
      describeSummary(five, plain, { stage: "chapter", chapter: 7, of: 7, text: "" }, "story").row,
    ).toBe("chapter 7 of 7…");
    expect(
      describeSummary(five, plain, { stage: "current", chapter: 8, of: 7, text: "" }, "story").row,
    ).toBe("to here…");
    expect(
      describeSummary(five, plain, { stage: "names", chapter: 7, of: 7, text: "" }, "story").row,
    ).toBe("characters…");
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
