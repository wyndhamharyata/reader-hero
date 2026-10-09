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
  readonly index: number;
}

export interface Coverage {
  readonly target: number;
  // Null until 100 words of the chapter are read, so a glance past a chapter start asks for nothing.
  readonly current: {
    readonly chapter: Chapter;
    readonly end: number;
    readonly text: string;
  } | null;
}

// `chapter` is 1-based; 0 means the job has not reached its first chapter.
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

const units = (kind: BookKind): { one: string; many: string; names: string } =>
  kind === "story"
    ? { one: "chapter", many: "chapters", names: "characters" }
    : { one: "section", many: "sections", names: "terms" };

export const currentFresh = (summary: Summary | null, cover: Coverage): boolean =>
  cover.current === null ||
  (summary?.current !== undefined &&
    summary.current.heading === cover.current.chapter.heading &&
    summary.current.end === cover.current.end);

// The action is null when the summary is current.
export function describeSummary(
  summary: Summary | null,
  cover: Coverage,
  run: SummaryRun | null,
  kind: BookKind,
): { readonly row: string; readonly action: string | null } {
  const unit = units(kind);
  // Counts, never chapter numbers: a book's own numbering can start at a prologue or skip.
  const amount = (n: number): string => `${n} ${n === 1 ? unit.one : unit.many}`;
  if (run?.stage === "names") return { row: `Updating ${unit.names}`, action: null };
  if (run?.stage === "current") return { row: "Current position", action: null };
  if (run?.chapter === 0) return { row: "Starting", action: null };
  if (run !== null) return { row: `${amount(run.of - run.chapter + 1)} left`, action: null };
  const count = Math.min(summary?.chapters.length ?? 0, cover.target);
  const pending = Math.max(0, cover.target - count);
  const row =
    count === 0 ? "None" : `${amount(count)}${pending > 0 ? ` · ${pending} pending` : ""}`;
  const stale = !currentFresh(summary, cover);
  let action: string | null = null;
  if (pending > 0 && stale) action = `Summarise ${amount(pending)} and current position`;
  else if (pending > 0) action = `Summarise ${amount(pending)}`;
  else if (stale) {
    action =
      summary?.current === undefined ? "Summarise current position" : "Update current position";
  } else if (summary !== null && (summary.namesThrough < count || summary.required.length > 0)) {
    action = `Update ${unit.names}`;
  }
  return { row, action };
}

const bookLine = (meta: BookMeta): string =>
  `Book: ${meta.title}${meta.author === undefined ? "" : ` by ${meta.author}`}.`;

// A reply without the blank line is both the line and the paragraph.
const parseReply = (text: string): { line: string; paragraph: string } => {
  const trimmed = text.trim();
  const cut = trimmed.indexOf("\n\n");
  if (cut === -1) return { line: trimmed.split("\n")[0] ?? "", paragraph: trimmed };
  return {
    line: trimmed.slice(0, cut).split("\n").join(" ").trim(),
    paragraph: trimmed.slice(cut + 2).trim(),
  };
};

// A model can wrap the JSON in prose, so the outermost braces are cut out.
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
      const chapter = Math.round(Number(row.first)) || max;
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

// One write per chapter, so a stop or a lost network keeps every finished chapter.
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
        removed: [],
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
        // A blocked or cut-off reply must not be stored as a finished chapter.
        if (text.trim() === "") {
          return yield* new AiFailure({
            reason: "malformed",
            message: "Provider returned no text",
          });
        }
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
        `Heading: ${chapter.heading}.`,
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
      record = yield* store.update(input.meta.id, (current) => {
        const base = current ?? record;
        return new Summary({
          ...base,
          model: settings.model,
          updatedAt: Date.now(),
          chapters: [
            ...base.chapters,
            { heading: chapter.heading, page: chapter.page, line, paragraph },
          ],
        });
      });
    }

    if (record.namesThrough < of || record.required.length > 0) {
      yield* onProgress({ stage: "names", chapter: record.chapters.length, of, text: "" });
      const namesSystem = story
        ? 'You keep the list of characters of a story: the people and other beings who act in it. A place, a group, an object or a condition is not an entry. Merge the new chapter summaries into the list. Keep every entry, update a note when the new chapters add to it, and add each character who appears for the first time. Order the list by importance to the protagonist: the protagonist first, then those closest to them, then the rest. A note is at most 20 words and says who the character is to the story so far. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","first":1}]}, where first is the # of the chapter where the entry first appears.'
        : 'You keep the list of terms of a document. Merge the new section summaries into the list. Keep every entry, update a note when the new sections add to it, and add each term that appears for the first time. Order the list by importance to the subject of the document, the central terms first. A note is at most 20 words. Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","first":1}]}, where first is the # of the section where the term first appears.';
      const fresh = record.chapters.slice(record.namesThrough, of);
      const visibleNames = record.names.filter(
        (entry) => !story || entry.edited === true || entry.chapter <= of,
      );
      const pinned = visibleNames.filter((entry) => entry.edited === true);
      const user = [
        bookLine(input.meta),
        "",
        "List so far (JSON):",
        JSON.stringify(
          visibleNames.map(({ name, note, chapter }) => ({ name, note, first: chapter })),
        ),
        "",
        ...(record.required.length === 0
          ? []
          : [`Entries the reader asked for: ${record.required.join(", ")}`, ""]),
        ...(pinned.length === 0
          ? []
          : [
              `Entries the reader edited, to keep as written: ${pinned.map((entry) => entry.name).join(", ")}`,
              "",
            ]),
        ...(record.removed.length === 0
          ? []
          : [`Entries the reader removed, to leave out: ${record.removed.join(", ")}`, ""]),
        `New ${unit.many}:`,
        "",
        // A # of our own, since the book's numbering can clash with the order of the list.
        ...fresh.flatMap((chapter, offset) => [
          `#${record.namesThrough + offset + 1} ${chapter.heading}`,
          chapter.paragraph,
          "",
        ]),
        "Return the merged list.",
      ].join("\n");
      const text = yield* stream(namesSystem, user, null, true);
      const names = parseNames(text, Math.max(1, of));
      if (names === null) {
        return yield* new AiFailure({
          reason: "malformed",
          message: `The ${unit.names} list was not JSON`,
        });
      }
      const sent = record.required;
      // The reader's edits and removals win over the model's list, those made during the request too.
      record = yield* store.update(input.meta.id, (current) => {
        const base = current ?? record;
        const merged: Array<(typeof base.names)[number]> = names.filter(
          (entry) =>
            !base.removed.some(
              (name) => name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
            ),
        );
        for (const entry of base.names) {
          if (entry.edited !== true && (!story || entry.chapter <= of)) continue;
          const at = merged.findIndex(
            (candidate) => candidate.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
          );
          if (at === -1) merged.push(entry);
          else merged[at] = entry;
        }
        return new Summary({
          ...base,
          updatedAt: Date.now(),
          names: merged,
          namesThrough: Math.min(base.chapters.length, Math.max(base.namesThrough, of)),
          required: base.required.filter((name) => !sent.includes(name)),
        });
      });
    }

    if (cover.current !== null && !currentFresh(record, cover)) {
      const number = cover.target + 1;
      const previous = record.chapters[cover.target - 1]?.paragraph;
      const user = [
        bookLine(input.meta),
        `Heading: ${cover.current.chapter.heading}, up to where the reader stopped.`,
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
      const current = {
        heading: cover.current.chapter.heading,
        end: cover.current.end,
        text: text.trim(),
      };
      record = yield* store.update(
        input.meta.id,
        (stored) => new Summary({ ...(stored ?? record), updatedAt: Date.now(), current }),
      );
    }

    return record;
  });
}

// The summary is the context, not the book's text: a small request that knows only what was read.
export function summaryFollowUp(
  input: SummaryInput,
  settings: AiSettings,
  summary: Summary,
  question: string,
  onText: (text: string) => void,
): Effect.Effect<Summary | null, AiFailure | StorageFailure, AiClient | SummaryStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* SummaryStore;
    const list = chapters(input.parsed);
    const cover = coverage(list, input.parsed, input.kind, input.index);
    const covered = summary.chapters.slice(0, cover.target);
    const current =
      summary.current !== undefined &&
      summary.current.end <= input.index + 1 &&
      !covered.some((chapter) => chapter.heading === summary.current?.heading)
        ? summary.current
        : undefined;
    const names = summary.names.filter(
      (entry) => input.kind !== "story" || entry.edited === true || entry.chapter <= cover.target,
    );
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
      ...covered.flatMap((chapter) => [chapter.heading, chapter.paragraph, ""]),
      ...(current === undefined
        ? []
        : [`${current.heading}, up to where the reader stopped`, current.text, ""]),
      `${unit.names.charAt(0).toUpperCase()}${unit.names.slice(1)}:`,
      ...names.map((entry) => `${entry.name}: ${entry.note}`),
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
    if (text.trim() === "") {
      return yield* new AiFailure({ reason: "malformed", message: "Provider returned no text" });
    }
    // A summary discarded while the answer streamed stays discarded.
    return yield* store.update(summary.bookId, (current) =>
      current === null
        ? null
        : new Summary({
            ...current,
            thread: [
              ...current.thread,
              { role: "user", content: question },
              { role: "assistant", content: text },
            ],
          }),
    );
  });
}
