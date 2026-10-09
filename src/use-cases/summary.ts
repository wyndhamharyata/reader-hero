import { Effect, Stream } from "effect";
import { CONSENT_VERSION, Summary, type AiSettings, type BookKind } from "@/domain/ai";
import type { BookMeta, ParsedBook } from "@/domain/book";
import { AiFailure, type StorageFailure } from "@/domain/errors";
import { guessKind } from "@/lib/guess-kind";
import { buildShelf, type LibraryCard, type Shelf } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { SummaryStore } from "@/services/summary-store";
import { chapters, spanText, type Chapter } from "@/use-cases/ai-context";

export interface SummaryInput {
  readonly meta: BookMeta;
  readonly parsed: ParsedBook;
  readonly kind: BookKind;
  readonly index: number;
  // What the earlier books of its series say of their characters, for the names merge to carry on.
  readonly earlier?: ReadonlyArray<{ readonly name: string; readonly note: string }>;
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

// `chapter` is 1-based; 0 means the job has not reached its first chapter. A series run names its volume in `book`.
export interface SummaryRun {
  readonly stage: "chapter" | "names" | "current" | "volume";
  readonly chapter: number;
  readonly of: number;
  readonly text: string;
  readonly book?: string;
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
  if (run?.stage === "volume") return { row: "Series summary", action: null };
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

// One scope line and paragraph per book of the series; the action is null when every paragraph is current.
export function describeSeries(
  volumes: ReadonlyArray<{
    readonly card: LibraryCard;
    readonly order: "earlier" | "current" | "later";
    readonly scope: { readonly input: SummaryInput; readonly cover: Coverage } | null;
  }>,
  summaries: ReadonlyMap<string, Summary | null>,
  run: SummaryRun | null,
): {
  readonly rows: ReadonlyArray<{ readonly scope: string; readonly text: string | null }>;
  readonly action: string | null;
  readonly status: string | null;
} {
  let pending = 0;
  // Update only when every pending volume shows a paragraph already, as for the current position.
  let unmade = 0;
  const rows = volumes.map(({ card, order, scope }) => {
    if (order === "current") return { scope: "Current · in Summary", text: null };
    if (order === "later") return { scope: "Later · not included", text: null };
    if (scope === null) return { scope: "Not included", text: null };
    const { input, cover } = scope;
    const unit = units(input.kind);
    const summary = summaries.get(card.book.id) ?? null;
    const stored = summary?.volume;
    const missing = cover.target - Math.min(summary?.chapters.length ?? 0, cover.target);
    const fresh =
      stored !== undefined &&
      stored.chapters === cover.target &&
      stored.current === cover.current?.end;
    // A paragraph past the boundary, as after Finished is turned off, would tell what was not read.
    const past =
      stored !== undefined &&
      (stored.chapters > cover.target ||
        (stored.chapters === cover.target && (stored.current ?? 0) > (cover.current?.end ?? 0)));
    if (!fresh) pending += 1;
    if (!fresh && (stored === undefined || past)) unmade += 1;
    const whole =
      card.status === "finished" || input.kind === "reference"
        ? "Whole book"
        : "Up to current position";
    const streaming =
      run?.stage === "volume" && run.book === card.book.id && run.text !== "" ? run.text : null;
    return {
      scope:
        missing > 0
          ? `${whole} · ${missing} ${missing === 1 ? unit.one : unit.many} pending`
          : fresh
            ? whole
            : `${whole} · 1 pending`,
      text: streaming ?? (stored === undefined || past ? null : stored.text),
    };
  });
  // The run's stage in the Summary's words, after the title of the volume it writes.
  const running = volumes.find((volume) => volume.card.book.id === run?.book);
  let status: string | null = run === null ? null : "Starting";
  if (run !== null && running !== undefined) {
    const kind = running.scope?.input.kind ?? "story";
    const { row } = describeSummary(null, { target: 0, current: null }, run, kind);
    status = `${running.card.book.title} · ${row}`;
  }
  return {
    rows,
    action:
      pending === 0
        ? null
        : `${unmade === 0 ? "Update" : "Summarise"} ${pending} ${pending === 1 ? "volume" : "volumes"}`,
    status,
  };
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

// One request: the list so far and the chapter summaries after it, up to `of`, merged into one list.
export function mergeNames(
  input: SummaryInput,
  record: Summary,
  of: number,
  settings: AiSettings,
): Effect.Effect<Summary, AiFailure | StorageFailure, AiClient | SummaryStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* SummaryStore;
    const story = input.kind === "story";
    const unit = units(input.kind);
    const earlier = story ? (input.earlier ?? []) : [];
    const namesSystem = story
      ? `You keep the list of characters of a story: the people and other beings who act in it. A place, a group, an object or a condition is not an entry. Merge the new chapter summaries into the list. Keep every entry, update a note when the new chapters add to it, and add each character who appears for the first time. Order the list by importance to the protagonist: the protagonist first, then those closest to them, then the rest. A note is at most ${earlier.length === 0 ? 20 : 25} words and says who the character is to the story so far.${earlier.length === 0 ? "" : ' This book continues a series, and "Known from earlier books" says what the earlier books told of their characters. That list is background, not entries: the list holds only characters whom the chapter summaries of this book name. When one of them appears in this book, the note may keep the gist of the earlier books in a few words, only if it matters to this book so far.'} Write in the language of the summaries. Reply with JSON only, in this shape: {"names":[{"name":"","note":"","first":1}]}, where first is the # of the chapter where the entry first appears.`
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
      ...(earlier.length === 0
        ? []
        : ["Known from earlier books (JSON):", JSON.stringify(earlier), ""]),
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
    if (text.trim() === "") {
      return yield* new AiFailure({ reason: "malformed", message: "Provider returned no text" });
    }
    const names = parseNames(text, Math.max(1, of));
    if (names === null) {
      return yield* new AiFailure({
        reason: "malformed",
        message: `The ${unit.names} list was not JSON`,
      });
    }
    const sent = record.required;
    // The reader's edits and removals win over the model's list, those made during the request too.
    return yield* store.update(input.meta.id, (current) => {
      const base = current ?? record;
      // The model carries earlier books' characters over whole, so in a series an entry stays only
      // when this book's summaries name it: the whole name, or one word of it that is not a title.
      const told = base.chapters
        .slice(0, of)
        .map((chapter) => `${chapter.heading}\n${chapter.paragraph}`)
        .join("\n");
      const merged: Array<(typeof base.names)[number]> = names.filter(
        (entry) =>
          !base.removed.some(
            (name) => name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
          ) &&
          (earlier.length === 0 ||
            sent.some((name) => name.trim().toLowerCase() === entry.name.trim().toLowerCase()) ||
            told.includes(entry.name) ||
            entry.name
              .split(" ")
              .some((word) => word.length > 2 && !word.endsWith(".") && told.includes(word))),
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
  });
}

// One write per chapter, so a stop or a lost network keeps every finished chapter.
export function summariseNext(
  input: SummaryInput,
  settings: AiSettings,
  onProgress: (run: SummaryRun) => Effect.Effect<void>,
  // A series run leaves the names to the book's own Summary: its paragraph does not use them.
  names = true,
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

    if (names && (record.namesThrough < of || record.required.length > 0)) {
      yield* onProgress({ stage: "names", chapter: record.chapters.length, of, text: "" });
      record = yield* mergeNames(input, record, of, settings);
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

// Each book of the series in order; only an earlier volume has a scope, up to its boundary.
export function seriesScope(
  series: Shelf["series"][number],
  bookId: string,
): Effect.Effect<
  ReadonlyArray<{
    readonly card: LibraryCard;
    readonly order: "earlier" | "current" | "later";
    readonly scope: { readonly input: SummaryInput; readonly cover: Coverage } | null;
  }>,
  StorageFailure,
  BookStore
> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const at = series.books.findIndex((card) => card.book.id === bookId);
    return yield* Effect.forEach(
      series.books,
      (card, place) =>
        Effect.gen(function* () {
          const order: "earlier" | "current" | "later" =
            place < at ? "earlier" : place === at ? "current" : "later";
          if (order !== "earlier" || card.status === "not-started") {
            return { card, order, scope: null };
          }
          const id = card.book.id;
          const [parsed, progress, prefs] = yield* Effect.all(
            [
              // A book with no reader text has nothing to summarise.
              store.getParsed(id).pipe(
                Effect.catchTags({
                  BookNotFound: () => Effect.succeed(null),
                  ParsedMissing: () => Effect.succeed(null),
                }),
              ),
              store.getProgress(id),
              store.getPrefs(id),
            ],
            { concurrency: "unbounded" },
          );
          if (parsed === null) return { card, order, scope: null };
          const kind = prefs?.kind ?? guessKind(card.book, parsed);
          // The boundary of the book's own Summary: its end when Finished, else its furthest position.
          const index =
            card.status === "finished"
              ? parsed.blocks.length
              : Math.max(progress?.blockIndex ?? 0, progress?.furthest ?? 0);
          const cover = coverage(chapters(parsed), parsed, kind, index);
          if (cover.target === 0 && cover.current === null) return { card, order, scope: null };
          return { card, order, scope: { input: { meta: card.book, parsed, kind, index }, cover } };
        }),
      { concurrency: "unbounded" },
    );
  });
}

// One list over the earlier volumes, the latest first, so a name keeps its newest note and no volume
// needs a list of its own; at most 60 entries, so a long series does not fill each request.
export function earlierNames(
  series: Shelf["series"][number] | null,
  input: SummaryInput,
  settings: AiSettings,
): Effect.Effect<
  ReadonlyArray<{ readonly name: string; readonly note: string }>,
  StorageFailure,
  SummaryStore
> {
  return Effect.gen(function* () {
    // The current consent text is the one that names what a later volume's list sends.
    if (series === null || input.kind !== "story" || settings.consentVersion !== CONSENT_VERSION) {
      return [];
    }
    const store = yield* SummaryStore;
    const at = series.books.findIndex((card) => card.book.id === input.meta.id);
    const seen = new Set<string>();
    const entries: Array<{ name: string; note: string }> = [];
    for (const card of series.books.slice(0, Math.max(0, at)).reverse()) {
      const summary = yield* store.get(card.book.id);
      for (const entry of summary?.names ?? []) {
        const key = entry.name.trim().toLowerCase();
        // Only what the reader's own list of that book shows: the merged chapters, or an edit.
        if (
          seen.has(key) ||
          (entry.edited !== true && entry.chapter > (summary?.namesThrough ?? 0))
        ) {
          continue;
        }
        seen.add(key);
        entries.push({ name: entry.name, note: entry.note });
      }
    }
    return entries.slice(0, 60);
  });
}

// One request per earlier volume, in series order, from its summaries inside the boundary and nothing past it.
export function summariseSeries(
  series: Shelf["series"][number],
  bookId: string,
  settings: AiSettings,
  onProgress: (run: SummaryRun) => Effect.Effect<void>,
): Effect.Effect<void, AiFailure | StorageFailure, AiClient | SummaryStore | BookStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* SummaryStore;
    // The paragraph of the volume before, so names and threads go on from book to book.
    let previous: Array<string> = [];
    for (const [place, { scope }] of (yield* seriesScope(series, bookId)).entries()) {
      if (scope === null) continue;
      const { input, cover } = scope;
      const book = input.meta.id;
      const stored = (yield* store.get(book))?.volume;
      let paragraph = stored?.text ?? "";
      if (
        stored === undefined ||
        stored.chapters !== cover.target ||
        stored.current !== cover.current?.end
      ) {
        const record = yield* summariseNext(
          input,
          settings,
          (run) => onProgress({ ...run, book }),
          false,
        );
        const unit = units(input.kind);
        const current =
          cover.current !== null && currentFresh(record, cover) ? record.current : undefined;
        const user = [
          `Series: ${series.name}, book ${place + 1} of ${series.count}.`,
          bookLine(input.meta),
          ...previous,
          "",
          `${unit.one.charAt(0).toUpperCase()}${unit.one.slice(1)} summaries:`,
          ...record.chapters
            .slice(0, cover.target)
            .flatMap((chapter) => [chapter.heading, chapter.paragraph, ""]),
          ...(current === undefined
            ? []
            : [`${current.heading}, up to where the reader stopped`, current.text]),
        ]
          .join("\n")
          .trim();
        yield* onProgress({
          stage: "volume",
          chapter: cover.target,
          of: cover.target,
          text: "",
          book,
        });
        let text = "";
        yield* client
          .complete(
            settings,
            "Summarise one book of a series from its chapter summaries. Use only the text given. Write one paragraph, at most 150 words, in the past tense. No headings, lists, predictions, opinions or questions. Write in the language of the summaries.",
            [{ role: "user", content: user }],
          )
          .pipe(
            Stream.runForEach((delta) => {
              if (delta.type !== "text") return Effect.void;
              text += delta.text;
              return onProgress({
                stage: "volume",
                chapter: cover.target,
                of: cover.target,
                text,
                book,
              });
            }),
          );
        if (text.trim() === "") {
          return yield* new AiFailure({
            reason: "malformed",
            message: "Provider returned no text",
          });
        }
        paragraph = text.trim();
        // A summary discarded during the request stays discarded.
        const saved = yield* store.update(book, (latest) =>
          latest === null
            ? null
            : new Summary({
                ...latest,
                volume: {
                  text: paragraph,
                  chapters: cover.target,
                  current: cover.current?.end,
                  model: settings.model,
                  updatedAt: Date.now(),
                },
              }),
        );
        if (saved === null) return;
      }
      previous = [`Book ${place + 1}, ${input.meta.title}: ${paragraph}`];
    }
  });
}

// Every later volume of every series, first to last, so each rebuilt list reaches the volumes after it.
export function laterVolumes(): Effect.Effect<
  ReadonlyArray<{ readonly series: Shelf["series"][number]; readonly card: LibraryCard }>,
  StorageFailure,
  BookStore
> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const [books, stored] = yield* Effect.all([store.list(), store.listSeries()], {
      concurrency: "unbounded",
    });
    const none = { status: null, length: null, author: null };
    return buildShelf(books, new Map(), "", none, "added", stored)
      .series.filter((series) => series.count >= 2)
      .flatMap((series) => series.books.slice(1).map((card) => ({ series, card })));
  });
}

// The volume's list again, from its own chapter summaries and the earlier volumes' lists. It covers the
// chapters it covered before, and the reader's edits and removals stay.
export function rebuildNames(
  series: Shelf["series"][number],
  card: LibraryCard,
  settings: AiSettings,
): Effect.Effect<void, AiFailure | StorageFailure, AiClient | BookStore | SummaryStore> {
  return Effect.gen(function* () {
    const id = card.book.id;
    const summary = yield* (yield* SummaryStore).get(id);
    if (summary === null || summary.namesThrough === 0) return;
    const store = yield* BookStore;
    const parsed = yield* store.getParsed(id).pipe(
      Effect.catchTags({
        BookNotFound: () => Effect.succeed(null),
        ParsedMissing: () => Effect.succeed(null),
      }),
    );
    if (parsed === null) return;
    const kind = (yield* store.getPrefs(id))?.kind ?? guessKind(card.book, parsed);
    if (kind !== "story") return;
    const input: SummaryInput = { meta: card.book, parsed, kind, index: 0 };
    const earlier = yield* earlierNames(series, input, settings);
    // Only the edited entries go back in, so every other note is written again with the earlier books.
    yield* mergeNames(
      { ...input, earlier },
      new Summary({
        ...summary,
        names: summary.names.filter((entry) => entry.edited === true),
        namesThrough: 0,
      }),
      summary.namesThrough,
      settings,
    );
  });
}
