import { Effect, Stream } from "effect";
import { Summary, type AiSettings, type BookKind } from "@/domain/ai";
import type { BookMeta, ParsedBook } from "@/domain/book";
import { AiFailure, type StorageFailure } from "@/domain/errors";
import { AiClient } from "@/services/ai-client";
import { ArtifactStore } from "@/services/artifact-store";
import { chapters, spanText } from "@/use-cases/ai-context";

export interface SummaryInput {
  readonly meta: BookMeta;
  readonly parsed: ParsedBook;
  readonly kind: BookKind;
  // How many chapters the summary is to cover: those before the position for a story, all of them
  // for a reference document.
  readonly target: number;
}

// The chapter in flight, 1-based, and its text so far; the names merge comes after the last chapter.
export interface SummaryRun {
  readonly stage: "chapter" | "names";
  readonly chapter: number;
  readonly of: number;
  readonly text: string;
}

const units = (kind: BookKind) =>
  kind === "story"
    ? { one: "chapter", many: "chapters", names: "characters" }
    : { one: "section", many: "sections", names: "terms" };

// The names list is behind when chapters landed after the last merge, or the reader added a name.
export const namesStale = (summary: Summary): boolean =>
  summary.namesThrough < summary.chapters.length || summary.required.length > 0;

// The Summary row's text, and the one action its sheet offers; null when the summary is current.
export function describeSummary(
  summary: Summary | null,
  target: number,
  run: SummaryRun | null,
  kind: BookKind,
): { readonly row: string; readonly action: string | null } {
  const unit = units(kind);
  if (run !== null) {
    const row =
      run.stage === "names"
        ? `${unit.names}…`
        : run.chapter === 0
          ? "starting…"
          : `${unit.one} ${run.chapter} of ${run.of}…`;
    return { row, action: null };
  }
  const count = summary?.chapters.length ?? 0;
  const behind = Math.max(0, target - count);
  const row =
    count === 0 ? "none" : `${unit.many} 1–${count}${behind > 0 ? ` · ${behind} behind` : ""}`;
  const action =
    behind > 0
      ? `Summarise ${behind === 1 ? `${unit.one} ${target}` : `${unit.many} ${count + 1}–${target}`}`
      : summary !== null && namesStale(summary)
        ? `Update ${unit.names}`
        : null;
  return { row, action };
}

const bookLine = (meta: BookMeta): string =>
  `Book: ${meta.title}${meta.author === undefined ? "" : ` by ${meta.author}`}.`;

// The reply is one sentence, a blank line, then the paragraph; a reply without the blank line is both.
const parseReply = (text: string): { line: string; paragraph: string } => {
  const trimmed = text.trim();
  const cut = trimmed.indexOf("\n\n");
  if (cut === -1) return { line: trimmed.split("\n")[0] ?? "", paragraph: trimmed };
  return {
    line: trimmed.slice(0, cut).split("\n").join(" ").trim(),
    paragraph: trimmed.slice(cut + 2).trim(),
  };
};

// The names reply is JSON, possibly wrapped in prose; a row without a name is dropped.
const parseNames = (
  text: string,
  max: number,
): Array<{ name: string; note: string; chapter: number }> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1)) as { names?: unknown };
    if (!Array.isArray(json.names)) return null;
    return (json.names as Array<Record<string, unknown>>).flatMap((row) => {
      if (typeof row?.name !== "string" || row.name.trim() === "") return [];
      const chapter = Math.round(Number(row.chapter)) || max;
      return [
        {
          name: row.name.trim(),
          note: typeof row.note === "string" ? row.note.trim() : "",
          chapter: Math.min(max, Math.max(1, chapter)),
        },
      ];
    });
  } catch {
    return null;
  }
};

// Summarises the chapters the summary does not cover yet, one request each, and writes after each
// one, so a stop or a lost network keeps every chapter that landed. The names merge is one request
// at the end. Nothing is sent twice.
export function summariseNext(
  input: SummaryInput,
  settings: AiSettings,
  onProgress: (run: SummaryRun) => Effect.Effect<void>,
): Effect.Effect<Summary, AiFailure | StorageFailure, AiClient | ArtifactStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* ArtifactStore;
    const list = chapters(input.parsed);
    const unit = units(input.kind);
    const of = Math.min(input.target, list.length);
    const story = input.kind === "story";
    let current =
      (yield* store.summary(input.meta.id)) ??
      new Summary({
        bookId: input.meta.id,
        model: settings.model,
        updatedAt: 0,
        chapters: [],
        names: [],
        namesThrough: 0,
        required: [],
        thread: [],
      });

    const system = story
      ? "You summarise one chapter of a story for a reader who has read it. Use only the chapter given and the previous summary. Do not name anyone who does not appear in them. Write in the language of the chapter. Reply with two parts separated by one blank line: first one sentence of at most 25 words, then one paragraph of at most 120 words in the present tense. No headings, no labels, no markdown."
      : "You summarise one section of a document for a reader who is coming back to it. Use only the section given. Write in the language of the section. Reply with two parts separated by one blank line: first one sentence of at most 25 words, then the key claims as three to five lines, each starting with a hyphen. No headings, no labels, no markdown.";

    for (let index = current.chapters.length; index < of; index += 1) {
      const chapter = list[index];
      if (chapter === undefined) break;
      const previous = current.chapters[index - 1]?.paragraph;
      const user = [
        bookLine(input.meta),
        `${unit.one} ${index + 1}: ${chapter.heading}.`,
        "",
        ...(previous === undefined ? [] : [`Previous ${unit.one}'s summary:`, previous, ""]),
        "Text:",
        spanText(input.parsed, chapter.start, chapter.end),
        "",
        `Summarise this ${unit.one}.`,
      ].join("\n");
      yield* onProgress({ stage: "chapter", chapter: index + 1, of, text: "" });
      let text = "";
      yield* client.complete(settings, system, [{ role: "user", content: user }]).pipe(
        Stream.runForEach((delta) => {
          if (delta.type !== "text") return Effect.void;
          text += delta.text;
          return onProgress({ stage: "chapter", chapter: index + 1, of, text });
        }),
      );
      const { line, paragraph } = parseReply(text);
      current = new Summary({
        ...current,
        model: settings.model,
        updatedAt: Date.now(),
        chapters: [
          ...current.chapters,
          { heading: chapter.heading, page: chapter.page, line, paragraph },
        ],
      });
      yield* store.putSummary(current);
    }

    if (!namesStale(current)) return current;
    yield* onProgress({ stage: "names", chapter: current.chapters.length, of, text: "" });
    const namesSystem = story
      ? 'You keep the list of characters, places and terms of a story. Merge the new chapter summaries into the list. Keep every entry, update a note when the new chapters add to it, and add each entry that appears for the first time. A note is at most 20 words and says what the entry is to the story so far. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","chapter":1}]}, where chapter is the number of the chapter where the entry first appears.'
      : 'You keep the list of terms of a document. Merge the new section summaries into the list. Keep every entry, update a note when the new sections add to it, and add each term that appears for the first time. A note is at most 20 words. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","chapter":1}]}, where chapter is the number of the section where the term first appears.';
    const fresh = current.chapters.slice(current.namesThrough);
    const user = [
      bookLine(input.meta),
      "",
      "List so far (JSON):",
      JSON.stringify(current.names),
      "",
      ...(current.required.length === 0
        ? []
        : [`Entries the reader asked for: ${current.required.join(", ")}`, ""]),
      `New ${unit.many}:`,
      "",
      ...fresh.flatMap((chapter, offset) => [
        `${unit.one} ${current.namesThrough + offset + 1}: ${chapter.heading}`,
        chapter.paragraph,
        "",
      ]),
      "Return the merged list.",
    ].join("\n");
    let text = "";
    yield* client
      .complete(settings, namesSystem, [{ role: "user", content: user }], { json: true })
      .pipe(
        Stream.runForEach((delta) =>
          Effect.sync(() => {
            if (delta.type === "text") text += delta.text;
          }),
        ),
      );
    const names = parseNames(text, current.chapters.length);
    if (names === null) {
      return yield* new AiFailure({
        reason: "malformed",
        message: `The ${unit.names} list was not JSON`,
      });
    }
    current = new Summary({
      ...current,
      updatedAt: Date.now(),
      names,
      namesThrough: current.chapters.length,
      required: [],
    });
    yield* store.putSummary(current);
    return current;
  });
}

// A follow-up sends the whole summary as the context, with the thread so far, and appends to it.
export function summaryFollowUp(
  input: SummaryInput,
  settings: AiSettings,
  summary: Summary,
  question: string,
  onText: (text: string) => void,
): Effect.Effect<Summary, AiFailure | StorageFailure, AiClient | ArtifactStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* ArtifactStore;
    const unit = units(input.kind);
    const system = [
      input.kind === "story"
        ? "You answer questions about a story from its summary so far. Use only the summary and the list of characters. Do not name anyone who does not appear in them. Answer in the language of the summary, in at most 120 words."
        : "You answer questions about a document from its summary so far. Use only the summary and the list of terms. Answer in the language of the summary, in at most 120 words.",
      "",
      bookLine(input.meta),
      "",
      "Summary so far:",
      "",
      ...summary.chapters.flatMap((chapter) => [chapter.heading, chapter.paragraph, ""]),
      `${unit.names.charAt(0).toUpperCase()}${unit.names.slice(1)}:`,
      ...summary.names.map((entry) => `${entry.name}: ${entry.note}`),
    ].join("\n");
    let text = "";
    yield* client
      .complete(settings, system, [...summary.thread, { role: "user", content: question }])
      .pipe(
        Stream.runForEach((delta) =>
          Effect.sync(() => {
            if (delta.type !== "text") return;
            text += delta.text;
            onText(text);
          }),
        ),
      );
    const next = new Summary({
      ...summary,
      thread: [
        ...summary.thread,
        { role: "user", content: question },
        { role: "assistant", content: text },
      ],
    });
    yield* store.putSummary(next);
    return next;
  });
}
