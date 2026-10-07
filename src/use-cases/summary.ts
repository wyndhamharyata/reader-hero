import { Effect, Stream } from "effect";
import { Summary, type AiSettings, type BookKind } from "@/domain/ai";
import type { BookMeta, ParsedBook } from "@/domain/book";
import { AiFailure, type StorageFailure } from "@/domain/errors";
import { AiClient } from "@/services/ai-client";
import { SummaryStore } from "@/services/summary-store";
import { chapters, spanText, type Chapter } from "@/use-cases/ai-context";

export interface SummaryInput {
  readonly meta: BookMeta;
  readonly parsed: ParsedBook;
  readonly kind: BookKind;
  // The block being read; the summary covers what comes before it.
  readonly index: number;
}

export interface Coverage {
  // How many chapters the summary is to cover: those before the position for a story, every
  // section for a reference document.
  readonly target: number;
  // For a story, the chapter that holds the position and its text up to there, once at least 100
  // words of it are read; its entry in the sheet is "to here".
  readonly current: {
    readonly chapter: Chapter;
    readonly end: number;
    readonly text: string;
  } | null;
}

// The chapter in flight, 1-based, and its text so far. The names merge comes after the last
// chapter, and the chapter being read, up to the position, comes last.
export interface SummaryRun {
  readonly stage: "chapter" | "names" | "current";
  readonly chapter: number;
  readonly of: number;
  readonly text: string;
}

export function coverage(
  list: ReadonlyArray<Chapter>,
  parsed: ParsedBook,
  kind: BookKind,
  index: number,
): Coverage {
  if (kind === "reference") return { target: list.length, current: null };
  const target = list.filter((chapter) => chapter.end <= index).length;
  const chapter = list[target];
  if (chapter === undefined || chapter.start > index) return { target, current: null };
  const text = spanText(parsed, chapter.start, index + 1);
  if (text.split(" ").length < 100) return { target, current: null };
  return { target, current: { chapter, end: index + 1, text } };
}

const units = (kind: BookKind) =>
  kind === "story"
    ? { one: "chapter", many: "chapters", names: "characters" }
    : { one: "section", many: "sections", names: "terms" };

// The names list is behind when chapters landed after the last merge, or the reader added a name.
export const namesStale = (summary: Summary): boolean =>
  summary.namesThrough < summary.chapters.length || summary.required.length > 0;

// The "to here" entry matches the position it was made at, or there is nothing to make it from.
export const currentFresh = (summary: Summary | null, cover: Coverage): boolean =>
  cover.current === null ||
  (summary?.current !== undefined &&
    summary.current.heading === cover.current.chapter.heading &&
    summary.current.end === cover.current.end);

// The Summary row's text, and the one action its sheet offers; null when the summary is current.
export function describeSummary(
  summary: Summary | null,
  cover: Coverage,
  run: SummaryRun | null,
  kind: BookKind,
): { readonly row: string; readonly action: string | null } {
  const unit = units(kind);
  if (run !== null) {
    const row =
      run.stage === "names"
        ? `${unit.names}…`
        : run.stage === "current"
          ? "to here…"
          : run.chapter === 0
            ? "starting…"
            : `${unit.one} ${run.chapter} of ${run.of}…`;
    return { row, action: null };
  }
  const count = summary?.chapters.length ?? 0;
  const behind = Math.max(0, cover.target - count);
  const row =
    count === 0 ? "none" : `${unit.many} 1–${count}${behind > 0 ? ` · ${behind} behind` : ""}`;
  const stale = !currentFresh(summary, cover);
  const number = cover.target + 1;
  const action =
    behind > 0
      ? stale
        ? `Summarise ${unit.many} ${count + 1}–${number}`
        : behind === 1
          ? `Summarise ${unit.one} ${cover.target}`
          : `Summarise ${unit.many} ${count + 1}–${cover.target}`
      : stale
        ? summary?.current === undefined
          ? "Summarise to here"
          : "Update to here"
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

// Brings the summary up to the position: the chapters it does not cover yet, one request each,
// written after each one so a stop or a lost network keeps every chapter that landed; then the
// names merge, one request; then the chapter being read, up to the position. Nothing finished is
// sent twice.
export function summariseNext(
  input: SummaryInput,
  settings: AiSettings,
  onProgress: (run: SummaryRun) => Effect.Effect<void>,
): Effect.Effect<Summary, AiFailure | StorageFailure, AiClient | SummaryStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* SummaryStore;
    const list = chapters(input.parsed);
    const cover = coverage(list, input.parsed, input.kind, input.index);
    const unit = units(input.kind);
    const of = Math.min(cover.target, list.length);
    const story = input.kind === "story";
    let record =
      (yield* store.get(input.meta.id)) ??
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

    const stream = (
      system: string,
      user: string,
      report: ((text: string) => Effect.Effect<void>) | null,
      json = false,
    ): Effect.Effect<string, AiFailure> =>
      Effect.gen(function* () {
        let text = "";
        yield* client.complete(settings, system, [{ role: "user", content: user }], { json }).pipe(
          Stream.runForEach((delta) => {
            if (delta.type !== "text") return Effect.void;
            text += delta.text;
            return report === null ? Effect.void : report(text);
          }),
        );
        return text;
      });

    const system = story
      ? "You summarise one chapter of a story for a reader who has read it. Use only the chapter given and the previous summary. Do not name anyone who does not appear in them. Write in the language of the chapter. Reply with two parts separated by one blank line: first one sentence of at most 25 words, then one paragraph of at most 120 words in the present tense. No headings, no labels, no markdown."
      : "You summarise one section of a document for a reader who is coming back to it. Use only the section given. Write in the language of the section. Reply with two parts separated by one blank line: first one sentence of at most 25 words, then the key claims as three to five lines, each starting with a hyphen. No headings, no labels, no markdown.";

    for (let index = record.chapters.length; index < of; index += 1) {
      const chapter = list[index];
      if (chapter === undefined) break;
      const previous = record.chapters[index - 1]?.paragraph;
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
      const text = yield* stream(system, user, (soFar) =>
        onProgress({ stage: "chapter", chapter: index + 1, of, text: soFar }),
      );
      const { line, paragraph } = parseReply(text);
      record = new Summary({
        ...record,
        model: settings.model,
        updatedAt: Date.now(),
        chapters: [
          ...record.chapters,
          { heading: chapter.heading, page: chapter.page, line, paragraph },
        ],
      });
      yield* store.put(record);
    }

    if (namesStale(record)) {
      yield* onProgress({ stage: "names", chapter: record.chapters.length, of, text: "" });
      const namesSystem = story
        ? 'You keep the list of characters of a story: the people and other beings who act in it. A place, a group, an object or a condition is not an entry. Merge the new chapter summaries into the list. Keep every entry, update a note when the new chapters add to it, and add each character who appears for the first time. A note is at most 20 words and says who the character is to the story so far. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","chapter":1}]}, where chapter is the number of the chapter where the entry first appears.'
        : 'You keep the list of terms of a document. Merge the new section summaries into the list. Keep every entry, update a note when the new sections add to it, and add each term that appears for the first time. A note is at most 20 words. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","chapter":1}]}, where chapter is the number of the section where the term first appears.';
      const fresh = record.chapters.slice(record.namesThrough);
      const user = [
        bookLine(input.meta),
        "",
        "List so far (JSON):",
        JSON.stringify(record.names),
        "",
        ...(record.required.length === 0
          ? []
          : [`Entries the reader asked for: ${record.required.join(", ")}`, ""]),
        `New ${unit.many}:`,
        "",
        ...fresh.flatMap((chapter, offset) => [
          `${unit.one} ${record.namesThrough + offset + 1}: ${chapter.heading}`,
          chapter.paragraph,
          "",
        ]),
        "Return the merged list.",
      ].join("\n");
      const text = yield* stream(namesSystem, user, null, true);
      const names = parseNames(text, record.chapters.length);
      if (names === null) {
        return yield* new AiFailure({
          reason: "malformed",
          message: `The ${unit.names} list was not JSON`,
        });
      }
      record = new Summary({
        ...record,
        updatedAt: Date.now(),
        names,
        namesThrough: record.chapters.length,
        required: [],
      });
      yield* store.put(record);
    }

    if (cover.current !== null && !currentFresh(record, cover)) {
      const number = cover.target + 1;
      const previous = record.chapters[cover.target - 1]?.paragraph;
      const user = [
        bookLine(input.meta),
        `${unit.one} ${number}: ${cover.current.chapter.heading}, up to where the reader stopped.`,
        "",
        ...(previous === undefined ? [] : [`Previous ${unit.one}'s summary:`, previous, ""]),
        "Text:",
        cover.current.text,
        "",
        `Summarise this part of the ${unit.one}.`,
      ].join("\n");
      yield* onProgress({ stage: "current", chapter: number, of, text: "" });
      const text = yield* stream(
        "You summarise the part of a chapter a reader has read so far. Use only the text given and the previous summary. Do not name anyone who does not appear in them. Write in the language of the text. Reply with one paragraph of at most 120 words in the present tense. No headings, no labels, no markdown.",
        user,
        (soFar) => onProgress({ stage: "current", chapter: number, of, text: soFar }),
      );
      record = new Summary({
        ...record,
        updatedAt: Date.now(),
        current: {
          heading: cover.current.chapter.heading,
          end: cover.current.end,
          text: text.trim(),
        },
      });
      yield* store.put(record);
    }

    return record;
  });
}

// A follow-up sends the whole summary as the context, with the thread so far, and appends to it.
export function summaryFollowUp(
  input: SummaryInput,
  settings: AiSettings,
  summary: Summary,
  question: string,
  onText: (text: string) => void,
): Effect.Effect<Summary, AiFailure | StorageFailure, AiClient | SummaryStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* SummaryStore;
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
      ...(summary.current === undefined
        ? []
        : [`${summary.current.heading}, to here`, summary.current.text, ""]),
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
    yield* store.put(next);
    return next;
  });
}
