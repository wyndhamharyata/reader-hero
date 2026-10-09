import { Effect, Semaphore, Stream } from "effect";
import { CONSENT_VERSION, type AiSettings } from "@/domain/ai";
import { Series } from "@/domain/book";
import { AiFailure, type StorageFailure } from "@/domain/errors";
import { buildShelf, seriesKey } from "@/lib/shelf";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { SettingsStore } from "@/services/settings-store";
import { spanText } from "@/use-cases/ai-context";

// Module-wide, so a run that is stopping and the run after it never have two requests open.
const oneRequest = Semaphore.makeUnsafe(1);

// Null when grouping may not send; else the totals, once no book is left to send.
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
      if (
        settings === null ||
        !settings.seriesGrouping ||
        settings.consentedAt === undefined ||
        settings.consentVersion !== CONSENT_VERSION
      ) {
        return null;
      }
      const client = yield* AiClient;
      const store = yield* BookStore;
      const grouped = yield* SettingsStore;
      const none = { status: null, length: null, author: null };

      while (true) {
        const books = yield* store.list();
        const sent = new Set(yield* grouped.groupedBooks());
        // EPUB series fields already give the series; a book that is still parsing has no text yet.
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
        const authors = new Set(batch.map((book) => book.author ?? ""));
        // Only the series of this request's authors, so a large library does not fill each request,
        // and without the books sent now, so no book shows twice.
        const sending = new Set(batch.map((book) => book.id));
        const existing = buildShelf(books, new Map(), "", none, "added", stored)
          .series.map((group) => ({
            ...group,
            books: group.books.filter((card) => !sending.has(card.book.id)),
          }))
          .filter(
            (group) =>
              group.books.length > 0 &&
              (authors.has("") || group.books.some((card) => authors.has(card.book.author ?? ""))),
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
        // Only the books sent now can be grouped; a listed series' book has a key but is not one.
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
        yield* client
          .complete(
            settings,
            'Group these books into series. A series is a set of books that its publisher numbers or orders. Use the titles, authors, file names and opening text. You may use what you know about published series. Put a book you are not sure of under "possible". Leave out books in no series. A side series with its own numbering is a separate series, even when its name starts like another. A book of a series that exists goes under that series\' name. Reply with JSON only, in this shape: {"series":[{"name":"","books":[{"key":"b1","number":1}],"possible":[{"key":"b2","number":2}]}]}, where number is the volume number, if known.',
            [{ role: "user", content: user }],
            { json: true },
          )
          .pipe(
            Stream.runForEach((delta) =>
              Effect.sync(() => {
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

        // A book in two series stays in the first; in one series, books come before possible.
        const claimed = new Set<string>();
        const entries = (json.series as Array<Record<string, unknown> | null>).flatMap((row) => {
          if (typeof row?.name !== "string") return [];
          // Plain text: a tag is cut out and a line break becomes a space, so no markup is stored.
          let plain = "";
          let tag = false;
          for (const char of row.name) {
            if (char === "<") tag = true;
            else if (char === ">") tag = false;
            else if (!tag) plain += char < " " ? " " : char;
          }
          const name = Array.from(
            plain
              .split(" ")
              .filter((word) => word !== "")
              .join(" "),
          )
            .slice(0, 80)
            .join("")
            .trim();
          if (name === "") return [];
          const [sure, unsure] = [row.books, row.possible].map((list) =>
            (Array.isArray(list) ? (list as Array<unknown>) : []).flatMap((item) => {
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
            }),
          );
          return [{ name, sure: sure ?? [], unsure: unsure ?? [] }];
        });

        // Read again, so an edit saved during the request wins; the whole write lands or none of it.
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
              const id = seriesKey(entry.name);
              const matches = [...changed.values(), ...fresh].filter(
                (series) => series.id === id || seriesKey(series.name) === id,
              );
              const record = matches[0];
              const members =
                shelf.series
                  .find((group) => seriesKey(group.id) === seriesKey(record?.id ?? id))
                  ?.books.map((card) => card.book.id) ?? [];
              const [sure, unsure] = [entry.sure, entry.unsure].map((list) =>
                list.filter(
                  (book) =>
                    !pinned.has(book.id) &&
                    !members.includes(book.id) &&
                    !(record?.removed.includes(book.id) ?? false),
                ),
              );
              if (sure === undefined || unsure === undefined) continue;
              const possible = record?.possible ?? [];
              if (record?.edited === true) {
                // A saved series keeps its name and order; the model can only offer a book.
                const offered = [...sure, ...unsure].filter(
                  (book) => !possible.some((other) => other.id === book.id),
                );
                if (offered.length === 0) continue;
                changed.set(
                  record.id,
                  new Series({ ...record, possible: [...possible, ...offered] }),
                );
                continue;
              }
              if (
                members.length + sure.length < 2 &&
                !sure.some((book) => book.number !== undefined)
              ) {
                continue;
              }
              const order = [...(record?.books ?? [])];
              // Numbered books first, in number order (1000 is above every kept number); each goes
              // before the first book with a higher number.
              for (const book of [...sure].sort(
                (a, b) => (a.number ?? 1000) - (b.number ?? 1000),
              )) {
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
              const kept = possible.filter((other) => !sure.some((book) => book.id === other.id));
              const offered = unsure.filter((book) => !kept.some((other) => other.id === book.id));
              if (sure.length === 0 && offered.length === 0) continue;
              changed.set(
                record?.id ?? id,
                new Series({
                  ...(record ?? { id, name: entry.name, removed: [] }),
                  books: order,
                  possible: [...kept, ...offered],
                  // A removed series that a new book starts again shows again.
                  ...(record?.hidden === true ? { hidden: false } : {}),
                }),
              );
            }
            for (const series of changed.values()) yield* store.putSeries(series);
            yield* grouped.putGroupedBooks([
              ...books.filter((book) => sent.has(book.id)).map((book) => book.id),
              ...batch.map((book) => book.id),
            ]);
          }),
        );
      }
    }),
  );
}

// Every book is sent again; the model's series and offers go, removed series come back, saved series stay.
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
