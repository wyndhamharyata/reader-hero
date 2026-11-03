import { Effect, Semaphore, Stream } from "effect";
import { hasConsent, type AiSettings } from "@/domain/ai";
import { Series, type BookMeta } from "@/domain/book";
import { AiFailure, type StorageFailure } from "@/domain/errors";
import { buildShelf, seriesKey, emptyFilters } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { SettingsStore } from "@/services/settings-store";
import { spanText } from "@/use-cases/ai-context";

// Module-wide, so a run that is stopping and the run after it never have two requests open.
const oneRequest = Semaphore.makeUnsafe(1);

interface GroupContext {
  readonly fresh: ReadonlyArray<Series>;
  readonly shelf: ReturnType<typeof buildShelf>;
  readonly changed: Map<string, Series>;
  readonly books: ReadonlyArray<BookMeta>;
  readonly pinned: ReadonlySet<string>;
}

function applyEntry(
  entry: {
    name: string;
    sure: Array<{ id: string; number?: number }>;
    unsure: Array<{ id: string; number?: number }>;
  },
  context: GroupContext,
): void {
  const id = seriesKey(entry.name);
  const matches = [...context.changed.values(), ...context.fresh].filter(
    (series) => series.id === id || seriesKey(series.name) === id,
  );
  const record = matches[0];
  const members =
    context.shelf.series
      .find((group) => seriesKey(group.id) === seriesKey(record?.id ?? id))
      ?.books.map((card) => card.book.id) ?? [];
  const sure = allowedBooks(entry.sure, context.pinned, members, record);
  const unsure = allowedBooks(entry.unsure, context.pinned, members, record);
  const possible = record?.possible ?? [];

  if (record?.edited === true) {
    applyToEdited(record, sure, unsure, possible, context.changed);
    return;
  }

  if (members.length + sure.length < 2 && !sure.some((book) => book.number !== undefined)) return;

  const order = orderedBooks(record, sure, context.books);
  const kept = possible.filter((other) => !sure.some((book) => book.id === other.id));
  const offered = unsure.filter((book) => !kept.some((other) => other.id === book.id));

  if (sure.length === 0 && offered.length === 0) return;

  const next = new Series({
    ...(record ?? { id, name: entry.name, removed: [] }),
    books: order,
    possible: [...kept, ...offered],
    // A removed series that a new book starts again shows again.
    ...(record?.hidden === true ? { hidden: false } : {}),
  });

  context.changed.set(next.id, next);
}

function allowedBooks(
  list: Array<{ id: string; number?: number }>,
  pinned: ReadonlySet<string>,
  members: ReadonlyArray<string>,
  record: Series | undefined,
): Array<{ id: string; number?: number }> {
  return list.filter(
    (book) =>
      !pinned.has(book.id) &&
      !members.includes(book.id) &&
      !(record?.removed.includes(book.id) ?? false),
  );
}

function applyToEdited(
  record: Series,
  sure: Array<{ id: string; number?: number }>,
  unsure: Array<{ id: string; number?: number }>,
  possible: Series["possible"],
  changed: Map<string, Series>,
): void {
  // A saved series keeps its name and order. The model can only offer a book.
  const offered = [...sure, ...unsure].filter(
    (book) => !possible.some((other) => other.id === book.id),
  );

  if (offered.length === 0) return;

  changed.set(record.id, new Series({ ...record, possible: [...possible, ...offered] }));
}

function orderedBooks(
  record: Series | undefined,
  sure: Array<{ id: string; number?: number }>,
  books: ReadonlyArray<BookMeta>,
): Series["books"] {
  const order = [...(record?.books ?? [])];

  // 1000 is above every kept number, so an unnumbered book sorts last.
  for (const book of [...sure].sort((a, b) => (a.number ?? 1000) - (b.number ?? 1000))) {
    if (order.some((other) => other.id === book.id)) continue;

    const number = book.number;
    const at =
      number === undefined
        ? -1
        : order.findIndex(
            (other) =>
              (other.number ??
                books.find((candidate) => candidate.id === other.id)?.seriesNumber ??
                -Infinity) > number,
          );

    if (at === -1) order.push(book);
    else order.splice(at, 0, book);
  }

  return order;
}

function seriesEntry(
  row: Record<string, unknown> | null | undefined,
  cards: ReadonlyMap<string, BookMeta>,
  claimed: Set<string>,
): Array<{
  name: string;
  sure: Array<{ id: string; number?: number }>;
  unsure: Array<{ id: string; number?: number }>;
}> {
  const name = cleanName(row?.name);

  if (name === "") return [];

  return [
    {
      name,
      sure: listedBooks(row?.books, cards, claimed),
      unsure: listedBooks(row?.possible, cards, claimed),
    },
  ];
}

// Plain text, with a isInTag cut out and a line break turned into a space, so no markup is stored.
function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";

  let plain = "";
  let isInTag = false;

  for (const char of value) {
    if (char === "<") isInTag = true;
    else if (char === ">") isInTag = false;
    else if (!isInTag) plain += char < " " ? " " : char;
  }

  return Array.from(
    plain
      .split(" ")
      .filter((word) => word !== "")
      .join(" "),
  )
    .slice(0, 80)
    .join("")
    .trim();
}

function listedBooks(
  list: unknown,
  cards: ReadonlyMap<string, BookMeta>,
  claimed: Set<string>,
): Array<{ id: string; number?: number }> {
  if (!Array.isArray(list)) return [];

  return (list as Array<unknown>).flatMap((item) => {
    const entry =
      typeof item === "string"
        ? { key: item }
        : (item as { key?: unknown; number?: unknown } | null);
    const book = typeof entry?.key === "string" ? cards.get(entry.key.trim()) : undefined;

    if (book === undefined || claimed.has(book.id)) return [];

    claimed.add(book.id);

    const number =
      typeof entry?.number === "number" || typeof entry?.number === "string"
        ? Number(entry.number)
        : Number.NaN;

    return [
      Number.isFinite(number) && number > 0 && number < 1000
        ? { id: book.id, number }
        : { id: book.id },
    ];
  });
}

// Null when grouping may not send. The totals when it may, once no book is left to send.
export function groupSeries(
  settings: AiSettings | null,
  onLeft: (left: number) => void,
): Effect.Effect<
  { readonly books: number; readonly series: number } | null,
  AiFailure | StorageFailure,
  AiClient | BookStore | SettingsStore
> {
  return oneRequest.withPermits(1)(
    Effect.gen(function* () {
      if (!hasConsent(settings) || !settings.seriesGrouping) return null;

      const client = yield* AiClient;
      const store = yield* BookStore;
      const grouped = yield* SettingsStore;
      const none = emptyFilters;

      while (true) {
        const books = yield* store.list();
        const sent = new Set(yield* grouped.groupedBooks());
        // EPUB series fields already give the series. A book that is still parsing has no text yet.
        const pending = books
          .filter(
            (book) =>
              !sent.has(book.id) &&
              !book.series?.trim() &&
              book.parseState !== "parsing" &&
              book.parseState !== "pending",
          )
          .sort((a, b) => (a.author ?? "").localeCompare(b.author ?? "") || a.addedAt - b.addedAt);

        if (pending.length === 0) {
          return {
            books: books.filter((book) => sent.has(book.id) || Boolean(book.series?.trim())).length,
            series: buildShelf(
              books,
              new Map(),
              "",
              none,
              "added",
              yield* store.listSeries(),
            ).series.filter((group) => group.count >= 2).length,
          };
        }

        onLeft(pending.length);

        // The cut goes before an author whose books would go on in the next request.
        const cut =
          pending.length > 30
            ? pending.findIndex((book) => book.author === pending[30]?.author)
            : -1;
        const batch = pending.slice(0, cut > 0 ? cut : 30);

        const stored = yield* store.listSeries();
        // A book with no author names no series, so one such book cannot list the whole library.
        const authors = new Set(batch.flatMap((book) => (book.author ? [book.author] : [])));
        // Only these authors' series keep the request small. This batch stays out, so none repeats.
        const sending = new Set(batch.map((book) => book.id));
        const existing = buildShelf(books, new Map(), "", none, "added", stored)
          .series.map((group) => ({
            ...group,
            books: group.books.filter((card) => !sending.has(card.book.id)),
          }))
          .filter(
            (group) =>
              group.books.length > 0 &&
              group.books.some(
                (card) => card.book.author !== undefined && authors.has(card.book.author),
              ),
          );
        const numbers = new Map(
          stored.flatMap((series) =>
            series.books.flatMap((entry) =>
              entry.number === undefined ? [] : [[entry.id, entry.number] as const],
            ),
          ),
        );
        const listed = new Map(
          existing
            .flatMap((group) => group.books)
            .map((card, index) => [card.book.id, `b${index + 1}`] as const),
        );
        // Only the books sent now can be grouped. A listed series' book has a key but is not one.
        const cards = new Map(
          batch.map((book, index) => [`b${listed.size + index + 1}` as string, book] as const),
        );
        const openings = yield* Effect.forEach(batch, (book) =>
          store.getParsed(book.id).pipe(
            // The first 200 blocks, so the whole book is not joined for 200 words.
            Effect.map((parsed) =>
              spanText(parsed, 0, 200)
                .split("\n")
                .join(" ")
                .split(" ")
                .filter((word) => word !== "")
                .slice(0, 200)
                .join(" "),
            ),
            Effect.catch(() => Effect.succeed("")),
          ),
        );
        const user = [
          ...(existing.length === 0
            ? []
            : [
                "Series that exist:",
                ...existing.map(
                  (group) =>
                    `${group.name}: ${group.books
                      .map((card) => {
                        const number = numbers.get(card.book.id) ?? card.book.seriesNumber;
                        return `${number === undefined ? "" : `#${number} `}${card.book.title} (${listed.get(card.book.id)})`;
                      })
                      .join(", ")}`,
                ),
                "",
              ]),
          "Books:",
          ...[...cards].flatMap(([key, book], index) => [
            `${key} | ${book.title} | ${book.author ?? ""} | ${book.fileName ?? ""}`,
            ...(openings[index] ? [`     ${openings[index]}`] : []),
          ]),
        ].join("\n");

        let reply = "";
        // Once the provider answers the batch has left, so a later failure cannot send it again.
        const sentNow = [
          ...books.filter((book) => sent.has(book.id)).map((book) => book.id),
          ...batch.map((book) => book.id),
        ];
        let isRecorded = false;

        yield* client
          .complete(
            settings,
            'Group these books into series. A series is a set of books that its publisher numbers or orders. Use the titles, authors, file names and opening text. You may use what you know about published series. Put a book you are not sure of under "possible". Leave out books in no series. A side series with its own numbering is a separate series, even when its name starts like another. A book of a series that exists goes under that series\' name. Reply with JSON only, in this form: {"series":[{"name":"","books":[{"key":"b1","number":1}],"possible":[{"key":"b2","number":2}]}]}, where number is the volume number, if known.',
            [{ role: "user", content: user }],
            { wantsJson: true, purpose: { stage: "grouping" } },
          )
          .pipe(
            Stream.runForEach((delta) =>
              Effect.gen(function* () {
                if (!isRecorded) {
                  isRecorded = true;
                  yield* grouped.putGroupedBooks(sentNow);
                }

                if (delta.type === "text") reply += delta.text;
              }),
            ),
          );

        if (reply.trim() === "") {
          return yield* new AiFailure({
            reason: "malformed",
            message: "Provider returned no text",
          });
        }

        // A model can wrap the JSON in prose, so the outermost braces are cut out.
        const start = reply.indexOf("{");
        const end = reply.lastIndexOf("}");
        let json: { series?: unknown } | null = null;

        try {
          if (start !== -1 && end > start) json = JSON.parse(reply.slice(start, end + 1));
        } catch {
          json = null;
        }

        if (!Array.isArray(json?.series)) {
          return yield* new AiFailure({
            reason: "malformed",
            message: "The series list was not JSON",
          });
        }

        // A book in two series stays in the first. In one series, books come before possible.
        const claimed = new Set<string>();
        const entries = (json.series as Array<Record<string, unknown> | null>).flatMap((row) =>
          seriesEntry(row, cards, claimed),
        );

        // Read again, so an edit saved during the request wins. The whole write goes in, or none of it.
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const fresh = yield* store.listSeries();
            const shelf = buildShelf(books, new Map(), "", none, "added", fresh);
            const pinned = new Set(
              fresh
                .filter((series) => series.edited === true && series.hidden !== true)
                .flatMap((series) => series.books.map((entry) => entry.id)),
            );
            const changed = new Map<string, Series>();

            for (const entry of entries) {
              applyEntry(entry, { fresh, shelf, changed, books, pinned });
            }

            for (const series of changed.values()) yield* store.putSeries(series);
            yield* grouped.putGroupedBooks(sentNow);
          }),
        );
      }
    }),
  );
}

// Every book is sent again. The model's series and offers go, removed series come back, saved series stay.
export function resetGrouping(): Effect.Effect<void, StorageFailure, BookStore | SettingsStore> {
  return oneRequest.withPermits(1)(
    Effect.gen(function* () {
      const store = yield* BookStore;

      for (const series of yield* store.listSeries()) {
        if (series.edited !== true) yield* store.removeSeries(series.id);
        else if (series.hidden === true || series.possible.length > 0) {
          yield* store.putSeries(new Series({ ...series, possible: [], hidden: false }));
        }
      }

      yield* (yield* SettingsStore).putGroupedBooks([]);
    }),
  );
}

// Without a provider nothing builds the model's series again, so only a deleted series comes back.
export function forgetDeletedSeries(): Effect.Effect<void, StorageFailure, BookStore> {
  return oneRequest.withPermits(1)(
    Effect.gen(function* () {
      const store = yield* BookStore;

      for (const series of yield* store.listSeries()) {
        if (series.hidden === true) yield* store.removeSeries(series.id);
      }
    }),
  );
}
