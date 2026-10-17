import { Effect } from "effect";
import { Series } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { shrinkPicture } from "@/lib/picture";
import { buildShelf, seriesKey, type Shelf } from "@/lib/shelf";
import { BookStore } from "@/services/book-store";

// Its books leave every other stored series and stay out of it, so a model run cannot pull one back.
export function saveSeries(edit: {
  // Null for a new series, which takes its name's id and joins a series of that name.
  readonly id: string | null;
  readonly name: string;
  readonly books: ReadonlyArray<string>;
  // The books the reader took out, so no source puts them back.
  readonly removed: ReadonlyArray<string>;
  // Undefined keeps the stored colour, or the palette's turn when there is none.
  readonly color?: number | undefined;
  // Undefined keeps the stored cover. Null goes back to the book in progress, or the first.
  readonly cover?: string | null | undefined;
  // The reader's own picture, for the cover "image".
  readonly image?: Blob | undefined;
}): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const stored = yield* store.listSeries();
    const id = edit.id ?? seriesKey(edit.name);
    const joined = edit.id === null ? yield* joinedBookIds(id, edit.books) : [];
    const books = new Set([...joined, ...edit.books]);
    const current = stored.find((series) => series.id === id);

    yield* detachOtherSeries(id, books, stored);

    const removed = [...new Set([...(current?.removed ?? []), ...edit.removed])];
    const color = edit.color ?? current?.color;
    const cover = yield* resolvedCover(id, current, edit);

    yield* store.putSeries(
      new Series({
        id,
        name: edit.name.trim(),
        books: seriesBooks(books, current),
        possible: (current?.possible ?? []).filter(
          (entry) => !books.has(entry.id) && !removed.includes(entry.id),
        ),
        edited: true,
        removed: removed.filter((bookId) => !books.has(bookId)),
        ...(color === undefined ? {} : { color }),
        ...(cover === undefined ? {} : { cover }),
      }),
    );
  });
}

function joinedBookIds(
  id: string,
  editBooks: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const shelf = buildShelf(
      yield* store.list(),
      new Map(),
      "",
      { status: null, length: null, author: null },
      "added",
      yield* store.listSeries(),
    );

    return (
      shelf.series
        .find((group) => seriesKey(group.id) === id)
        ?.books.map((card) => card.book.id)
        .filter((bookId) => !editBooks.includes(bookId)) ?? []
    );
  });
}

function detachOtherSeries(
  id: string,
  books: ReadonlySet<string>,
  stored: ReadonlyArray<Series>,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;

    for (const series of stored) {
      if (
        series.id === id ||
        ![...series.books, ...series.possible].some((entry) => books.has(entry.id))
      ) {
        continue;
      }

      yield* store.putSeries(
        new Series({
          ...series,
          books: series.books.filter((entry) => !books.has(entry.id)),
          possible: series.possible.filter((entry) => !books.has(entry.id)),
          removed: [
            ...series.removed,
            ...series.books.filter((entry) => books.has(entry.id)).map((entry) => entry.id),
          ],
        }),
      );
    }
  });
}

function resolvedCover(
  id: string,
  current: Series | undefined,
  edit: { readonly cover?: string | null | undefined; readonly image?: Blob | undefined },
): Effect.Effect<string | undefined, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const cover = edit.cover === undefined ? current?.cover : (edit.cover ?? undefined);

    if (cover !== "image" || edit.image === undefined) return cover;

    const shrunk = yield* shrinkPicture(edit.image);

    // A picture that does not decode keeps the cover as it was.
    if (shrunk === null) return current?.cover;

    yield* store.putImage(`series:${id}`, { id: "cover", ...shrunk });

    return cover;
  });
}

function seriesBooks(
  books: ReadonlySet<string>,
  current: Series | undefined,
): Array<{ id: string; number?: number }> {
  const entries = [...(current?.books ?? []), ...(current?.possible ?? [])];

  return [...books].map((bookId) => {
    // A book added from Possible keeps the model's number, which places the next one.
    const number = entries.find((entry) => entry.id === bookId)?.number;

    return number === undefined ? { id: bookId } : { id: bookId, number };
  });
}

// The grouping goes and the books stay. Its books stay out of it, but a new book can start it again.
export function hideSeries(
  id: string,
  name: string,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const stored = yield* store.listSeries();
    const members =
      buildShelf(
        yield* store.list(),
        new Map(),
        "",
        { status: null, length: null, author: null },
        "added",
        stored,
      )
        .series.find((group) => group.id === id)
        ?.books.map((card) => card.book.id) ?? [];
    const removed = stored.find((series) => series.id === id)?.removed ?? [];

    yield* store.putSeries(
      new Series({
        id,
        name,
        books: [],
        possible: [],
        removed: [...new Set([...removed, ...members])],
        hidden: true,
      }),
    );
  });
}

// Null takes the book out of its series and keeps it out. An id moves it to that series' end.
export function setBookSeries(
  bookId: string,
  seriesId: string | null,
): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const { series } = buildShelf(
      yield* store.list(),
      new Map(),
      "",
      { status: null, length: null, author: null },
      "added",
      yield* store.listSeries(),
    );
    const current = series.find((group) => group.books.some((card) => card.book.id === bookId));

    if (seriesId === null) {
      if (current === undefined) return;

      yield* saveSeries({
        id: current.id,
        name: current.name,
        books: current.books.map((card) => card.book.id).filter((id) => id !== bookId),
        removed: [bookId],
      });
      return;
    }

    const target = series.find((group) => group.id === seriesId);

    if (target === undefined || target.id === current?.id) return;

    yield* saveSeries({
      id: target.id,
      name: target.name,
      books: [...target.books.map((card) => card.book.id), bookId],
      removed: [],
    });
  });
}

// Null for a book alone in its series too, as the library shows that book as a single book.
export function findBookSeries(
  bookId: string,
): Effect.Effect<Shelf["series"][number] | null, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const [books, stored] = yield* Effect.all([store.list(), store.listSeries()], {
      concurrency: "unbounded",
    });
    const none = { status: null, length: null, author: null };
    const group = buildShelf(books, new Map(), "", none, "added", stored).series.find(
      (entry) => entry.count >= 2 && entry.books.some((card) => card.book.id === bookId),
    );

    if (group === undefined) return null;

    // The grouping reads no progress, so only the books of this series read theirs, for the badges.
    const reading = yield* Effect.forEach(
      group.books,
      (card) =>
        store
          .getProgress(card.book.id)
          .pipe(Effect.map((progress) => [card.book.id, progress] as const)),
      { concurrency: "unbounded" },
    );

    return (
      buildShelf(books, new Map(reading), "", none, "added", stored).series.find(
        (entry) => entry.id === group.id,
      ) ?? null
    );
  });
}
