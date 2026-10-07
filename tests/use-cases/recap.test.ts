import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, Summary, type AiMessage, type Artifact } from "@/domain/ai";
import { Block, BookMeta, PARSED_VERSION, ParsedBook } from "@/domain/book";
import type { Delta } from "@/lib/event-stream";
import { AiClient } from "@/services/ai-client";
import { ArtifactStore } from "@/services/artifact-store";
import { followUp, runRecap, storedRecap, type RecapInput } from "@/use-cases/recap";

const meta = new BookMeta({
  id: "b1",
  title: "Treasure Island",
  author: "Stevenson",
  addedAt: 0,
  fileSize: 1,
  pageCount: 2,
  parseState: "ready",
  charCount: 40,
  format: "epub",
});

const parsed = new ParsedBook({
  version: PARSED_VERSION,
  pageCount: 2,
  charCount: 40,
  blocks: [
    new Block({ kind: "heading", level: 1, text: "Prologue", page: 1 }),
    new Block({ kind: "paragraph", level: 0, text: "A map was drawn long before.", page: 1 }),
    new Block({ kind: "heading", level: 1, text: "Chapter 1", page: 1 }),
    new Block({ kind: "paragraph", level: 0, text: "The captain came to the inn.", page: 1 }),
    new Block({ kind: "paragraph", level: 0, text: "Pew served the black spot.", page: 2 }),
  ],
  toc: [],
  figuresThrough: 0,
});

const settings = new AiSettings({
  provider: "deepseek",
  apiKey: "k",
  model: "flash",
  linesInContents: true,
  autoSummary: false,
  summaryLength: "paragraph",
});

const input: RecapInput = { meta, parsed, kind: "story", index: 4, scope: "recent", summary: null };

interface Harness {
  readonly calls: Array<{ system: string; messages: ReadonlyArray<AiMessage> }>;
  readonly stored: Map<string, Artifact>;
  readonly layer: Layer.Layer<AiClient | ArtifactStore>;
}

function harness(deltas: ReadonlyArray<Delta>): Harness {
  const calls: Harness["calls"] = [];
  const stored = new Map<string, Artifact>();
  const client = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (_settings, system, messages) => {
        calls.push({ system, messages });
        return Stream.fromArray([...deltas]);
      },
      models: () => Effect.succeed([]),
      balance: () => Effect.succeed(null),
    }),
  );
  const store = Layer.succeed(
    ArtifactStore,
    ArtifactStore.of({
      get: (key) => Effect.succeed(stored.get(key) ?? null),
      put: (artifact) =>
        Effect.sync(() => {
          stored.set(artifact.key, artifact);
        }),
      summary: () => Effect.succeed(null),
      putSummary: () => Effect.void,
      removeSummary: () => Effect.void,
      summaryChanges: () => Stream.empty,
      removeBook: () => Effect.void,
    }),
  );
  return { calls, stored, layer: Layer.mergeAll(client, store) };
}

describe("recap", () => {
  it("given a stream, reports the text so far, stores the answer and skips reasoning", async () => {
    const { calls, stored, layer } = harness([
      { type: "reasoning", text: "hmm" },
      { type: "text", text: "Pew " },
      { type: "text", text: "came." },
    ]);
    const seen: Array<string> = [];

    const artifact = await Effect.runPromise(
      runRecap(input, settings, (text) => seen.push(text)).pipe(Effect.provide(layer)),
    );

    expect(seen).toEqual(["Pew ", "Pew came."]);
    expect(artifact.result).toBe("Pew came.");
    expect(artifact.heading).toBe("Chapter 1");
    expect(artifact.page).toBe(2);
    expect(stored.get(artifact.key)).toBe(artifact);
    expect(calls[0]?.messages[0]?.content).toContain("Pew served the black spot.");
    expect(calls[0]?.system).toContain("Do not name anyone");
  });

  it("given the same pages again, finds the stored recap without a call", async () => {
    const { calls, layer } = harness([{ type: "text", text: "x" }]);
    const first = await Effect.runPromise(
      runRecap(input, settings, () => {}).pipe(Effect.provide(layer)),
    );

    const found = await Effect.runPromise(storedRecap(input, settings).pipe(Effect.provide(layer)));

    expect(found?.key).toBe(first.key);
    expect(calls).toHaveLength(1);
  });

  it("given another scope, model or position, uses another key", async () => {
    const { layer } = harness([{ type: "text", text: "x" }]);
    const run = (next: RecapInput, with_: AiSettings) =>
      Effect.runPromise(runRecap(next, with_, () => {}).pipe(Effect.provide(layer)));
    const base = await run(input, settings);

    expect((await run({ ...input, scope: "chapter" }, settings)).key).not.toBe(base.key);
    expect((await run({ ...input, index: 3 }, settings)).key).not.toBe(base.key);
    expect((await run(input, new AiSettings({ ...settings, model: "pro" }))).key).not.toBe(
      base.key,
    );
  });

  it("given the Read so far scope, sends the stored paragraphs and the text since them", async () => {
    const { calls, layer } = harness([{ type: "text", text: "x" }]);
    // Chapters need 200 words to count, so each gets a filler paragraph.
    const filler = Array.from({ length: 200 }, (_, index) => `w${index}`).join(" ");
    const long = new ParsedBook({
      ...parsed,
      blocks: [
        parsed.blocks[0]!,
        parsed.blocks[1]!,
        new Block({ kind: "paragraph", level: 0, text: filler, page: 1 }),
        parsed.blocks[2]!,
        parsed.blocks[3]!,
        new Block({ kind: "paragraph", level: 0, text: filler, page: 1 }),
        parsed.blocks[4]!,
      ],
    });
    const summary = new Summary({
      bookId: "b1",
      model: "flash",
      updatedAt: 1,
      chapters: [{ heading: "Prologue", page: 1, line: "A map.", paragraph: "A map is drawn." }],
      names: [],
      namesThrough: 1,
      required: [],
      thread: [],
    });

    await Effect.runPromise(
      runRecap(
        { ...input, parsed: long, index: 6, scope: "sofar", summary },
        settings,
        () => {},
      ).pipe(Effect.provide(layer)),
    );

    const sent = calls[0]?.messages[0]?.content ?? "";
    expect(sent).toContain("Summary so far:\n\nPrologue\nA map is drawn.");
    expect(sent).not.toContain("A map was drawn long before.");
    expect(sent).toContain("Since then:\n\nChapter 1\n\nThe captain came to the inn.");
    expect(sent).toContain("Pew served the black spot.");
  });

  it("given a follow-up, sends the thread so far and appends the exchange", async () => {
    const { calls, stored, layer } = harness([{ type: "text", text: "Answer." }]);
    const first = await Effect.runPromise(
      runRecap(input, settings, () => {}).pipe(Effect.provide(layer)),
    );

    const next = await Effect.runPromise(
      followUp(input, settings, first, "Who is Pew?", () => {}).pipe(Effect.provide(layer)),
    );

    expect(calls[1]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(next.thread).toEqual([
      { role: "user", content: "Who is Pew?" },
      { role: "assistant", content: "Answer." },
    ]);
    expect(stored.get(first.key)?.thread).toHaveLength(2);
  });
});
