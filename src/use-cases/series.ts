import { Effect } from "effect";
import { Series } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { buildShelf, seriesKey, type Shelf } from "@/lib/shelf";
import { BookStore } from "@/services/book-store";

// Its books leave every other stored series and stay out of it, so a model run cannot pull one back.
export function saveSeries(edit: {
  // Null for a new series: it takes its name's id, so it joins a series of that name.
  readonly id: string | null;
  readonly name: string;
  readonly books: ReadonlyArray<string>;
  // The books the reader took out, so no source adds them again.
  readonly removed: ReadonlyArray<string>;
  // Undefined keeps the stored colour, or the palette's turn when there is none.
  readonly color?: number | undefined;
  // Undefined keeps the stored cover; null goes back to the book in progress, or the first.
  readonly cover?: string | null | undefined;
  // The reader's own picture, for the cover "image".
  readonly image?: Blob | undefined;
}): Effect.Effect<void, StorageFailure, BookStore> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    const stored = yield* store.listSeries();
    const id = edit.id ?? seriesKey(edit.name);
    const joined =
      edit.id === null
        ? (buildShelf(
            yield* store.list(),
            new Map(),
            "",
            { status: null, length: null, author: null },
            "added",
            stored,
          )
            .series.find((group) => seriesKey(group.id) === id)
            ?.books.map((card) => card.book.id)
            .filter((bookId) => !edit.books.includes(bookId)) ?? [])
        : [];
    const books = new Set([...joined, ...edit.books]);
    const current = stored.find((series) => series.id === id);

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

    const removed = [...new Set([...(current?.removed ?? []), ...edit.removed])];
    const color = edit.color ?? current?.color;
    let cover = edit.cover === undefined ? current?.cover : (edit.cover ?? undefined);
    const image = edit.image;
    if (cover === "image" && image !== undefined) {
      // A small JPEG, like a book's cover, so a large photo does not fill the store.
      const bitmap = yield* Effect.option(Effect.tryPromise(() => createImageBitmap(image)));
      const canvas = document.createElement("canvas");
      if (bitmap._tag === "Some") {
        canvas.width = 400;
        canvas.height = Math.round((400 * bitmap.value.height) / bitmap.value.width);
        canvas.getContext("2d")?.drawImage(bitmap.value, 0, 0, canvas.width, canvas.height);
        bitmap.value.close();
      }
      const blob =
        bitmap._tag === "None"
          ? null
          : yield* Effect.callback<Blob | null>((resume) =>
              canvas.toBlob((value) => resume(Effect.succeed(value)), "image/jpeg", 0.85),
            );
      // A picture that does not decode leaves the cover as it was.
      if (blob === null) cover = current?.cover;
      else {
        yield* store.putImage(`series:${id}`, {
          id: "cover",
          blob,
          width: canvas.width,
          height: canvas.height,
        });
      }
    }
    yield* store.putSeries(
      new Series({
        id,
        name: edit.name.trim(),
        books: [...books].map((bookId) => {
          // A book added from Possible keeps the model's number, which places the next one.
          const number = [...(current?.books ?? []), ...(current?.possible ?? [])].find(
            (entry) => entry.id === bookId,
          )?.number;
          return number === undefined ? { id: bookId } : { id: bookId, number };
        }),
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

// The grouping goes and the books stay; its books stay out of it, but a new book can start it again.
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

// Null takes the book out of its series and keeps it out; an id moves it to that series' end.
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
