import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, Summary, type AiMessage } from "@/domain/ai";
import { Block, BookMeta, PARSED_VERSION, ParsedBook, TocEntry } from "@/domain/book";
import { AiClient } from "@/services/ai-client";
import { ArtifactStore } from "@/services/artifact-store";
import { chapters, readSoFar } from "@/use-cases/ai-context";
import { describeSummary, summariseNext, type SummaryInput } from "@/use-cases/summary";

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
  summaryLength: "paragraph",
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

// Front matter, then three chapters of 300 words each.
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

interface Harness {
  readonly calls: Array<{ system: string; user: string; json: boolean }>;
  readonly puts: Array<Summary>;
  readonly layer: Layer.Layer<AiClient | ArtifactStore>;
}

// The fake provider answers a chapter request with two parts, and a names request with JSON.
function harness(stored: Summary | null, namesReply?: string): Harness {
  const calls: Harness["calls"] = [];
  const puts: Array<Summary> = [];
  let current = stored;
  const client = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (_settings, system, messages: ReadonlyArray<AiMessage>, options) => {
        const user = messages[messages.length - 1]?.content ?? "";
        const json = options?.json === true;
        calls.push({ system, user, json });
        const reply = json
          ? (namesReply ??
            'Here it is: {"names":[{"name":"Jim","note":"The narrator.","chapter":1},{"name":"Pew","note":"Blind.","chapter":"9"},{"note":"no name"}]}')
          : `One ${calls.length}.\n\nParagraph ${calls.length}.`;
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
    ArtifactStore,
    ArtifactStore.of({
      get: () => Effect.succeed(null),
      put: () => Effect.void,
      summary: () => Effect.succeed(current),
      putSummary: (next) =>
        Effect.sync(() => {
          current = next;
          puts.push(next);
        }),
      removeSummary: () => Effect.void,
      summaryChanges: () => Stream.empty,
      removeBook: () => Effect.void,
    }),
  );
  return { calls, puts, layer: Layer.mergeAll(client, store) };
}

describe("chapters", () => {
  it("given contents entries, drops the ones with under 200 words", () => {
    expect(chapters(novel).map((chapter) => [chapter.heading, chapter.start, chapter.end])).toEqual(
      [
        ["Chapter 1", 2, 4],
        ["Chapter 2", 4, 6],
        ["Chapter 3", 6, 8],
      ],
    );
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
});

describe("summariseNext", () => {
  it("given two chapters before the position, sends each once, writes after each, then merges names", async () => {
    const { calls, puts, layer } = harness(null);
    const progress: Array<string> = [];
    const input: SummaryInput = { meta, parsed: novel, kind: "story", target: 2 };

    const result = await Effect.runPromise(
      summariseNext(input, settings, (run) =>
        Effect.sync(() => progress.push(`${run.stage} ${run.chapter} ${run.text}`)),
      ).pipe(Effect.provide(layer)),
    );

    expect(calls.map((call) => call.json)).toEqual([false, false, true]);
    expect(calls[0]?.user).toContain("chapter 1: Chapter 1.");
    expect(calls[0]?.user).not.toContain("Previous chapter");
    expect(calls[1]?.user).toContain("Previous chapter's summary:\nParagraph 1.");
    expect(calls[2]?.user).toContain("chapter 2: Chapter 2\nParagraph 2.");
    expect(puts).toHaveLength(3);
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
    expect(progress[0]).toBe("chapter 1 ");
    expect(progress.at(-1)).toBe("names 2 ");
    expect(progress).toContain("chapter 1 One 1.\n\nParagraph 1.");
  });

  it("given a summary one chapter behind, sends only the new chapter and the new paragraph", async () => {
    const stored = new Summary({
      bookId: "b1",
      model: "flash",
      updatedAt: 1,
      chapters: [
        { heading: "Chapter 1", page: 1, line: "One.", paragraph: "First." },
        { heading: "Chapter 2", page: 2, line: "Two.", paragraph: "Second." },
      ],
      names: [{ name: "Jim", note: "The narrator.", chapter: 1 }],
      namesThrough: 2,
      required: ["Ben Gunn"],
      thread: [],
    });
    const { calls, layer } = harness(stored);
    const input: SummaryInput = { meta, parsed: novel, kind: "story", target: 3 };

    await Effect.runPromise(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.user).toContain("chapter 3: Chapter 3.");
    expect(calls[0]?.user).toContain("Previous chapter's summary:\nSecond.");
    expect(calls[1]?.user).toContain("Entries the reader asked for: Ben Gunn");
    expect(calls[1]?.user).toContain("New chapters:\n\nchapter 3: Chapter 3\nParagraph 1.");
    expect(calls[1]?.user).not.toContain("chapter 2: Chapter 2");
  });

  it("given a names reply that is not JSON, fails after the chapters are stored", async () => {
    const { puts, layer } = harness(null, "Sorry, no.");
    const input: SummaryInput = { meta, parsed: novel, kind: "story", target: 1 };

    const exit = await Effect.runPromiseExit(
      summariseNext(input, settings, () => Effect.void).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.namesThrough).toBe(0);
  });
});

describe("describeSummary", () => {
  const stored = new Summary({
    bookId: "b1",
    model: "flash",
    updatedAt: 1,
    chapters: Array.from({ length: 5 }, (_, index) => ({
      heading: `Chapter ${index + 1}`,
      page: 1,
      line: "",
      paragraph: "",
    })),
    names: [],
    namesThrough: 5,
    required: [],
    thread: [],
  });

  it("names the four states of the row and the one action", () => {
    expect(describeSummary(null, 7, null, "story")).toEqual({
      row: "none",
      action: "Summarise chapters 1–7",
    });
    expect(describeSummary(stored, 7, null, "story")).toEqual({
      row: "chapters 1–5 · 2 behind",
      action: "Summarise chapters 6–7",
    });
    expect(describeSummary(stored, 6, null, "story")).toEqual({
      row: "chapters 1–5 · 1 behind",
      action: "Summarise chapter 6",
    });
    expect(
      describeSummary(stored, 7, { stage: "chapter", chapter: 7, of: 7, text: "" }, "story"),
    ).toEqual({ row: "chapter 7 of 7…", action: null });
    expect(describeSummary(stored, 5, null, "story")).toEqual({
      row: "chapters 1–5",
      action: null,
    });
    expect(describeSummary(stored, 5, null, "reference")).toEqual({
      row: "sections 1–5",
      action: null,
    });
  });

  it("given names behind the chapters or an added name, offers the update", () => {
    const lagging = new Summary({ ...stored, namesThrough: 3 });
    expect(describeSummary(lagging, 5, null, "story").action).toBe("Update characters");
    const added = new Summary({ ...stored, required: ["Ben Gunn"] });
    expect(describeSummary(added, 5, null, "reference").action).toBe("Update terms");
  });
});

describe("readSoFar", () => {
  it("given a summary one chapter short, sends its paragraphs then the text from the gap", () => {
    const stored = new Summary({
      bookId: "b1",
      model: "flash",
      updatedAt: 1,
      chapters: [{ heading: "Chapter 1", page: 1, line: "One.", paragraph: "First." }],
      names: [],
      namesThrough: 1,
      required: [],
      thread: [],
    });

    const passage = readSoFar(novel, 7, stored);

    expect(
      passage.text.startsWith(
        "Summary so far:\n\nChapter 1\nFirst.\n\nSince then:\n\nChapter 2\n\nw0 ",
      ),
    ).toBe(true);
    expect(passage.text).toContain("Chapter 3");
    expect(passage.heading).toBe("Chapter 3");
  });

  it("given no summary, sends the text from the first chapter", () => {
    const passage = readSoFar(novel, 3, null);
    expect(passage.text.startsWith("Chapter 1\n\nw0 ")).toBe(true);
    expect(passage.text).not.toContain("Summary so far");
  });
});
