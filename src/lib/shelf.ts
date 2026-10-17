import {
  FINISHED_PERCENT,
  type BookMeta,
  type BookPrefs,
  type LibrarySort,
  type ReadingProgress,
  type Series,
} from "@/domain/book";
import { parseStateBadge, readingBadge } from "@/lib/badges";

// Each book as the library last read it, so a book that opens has its theme, title and place at once.
export const shelfRecords = new Map<
  string,
  {
    readonly meta: BookMeta;
    readonly progress: ReadingProgress | null;
    readonly prefs: BookPrefs | null;
  }
>();

export type FilterGroup = "status" | "length" | "author";
export type Filters = Readonly<Record<FilterGroup, string | null>>;

export const emptyFilters: Filters = { status: null, length: null, author: null };

export interface LibraryCard {
  readonly book: BookMeta;
  // 100% once the book is finished, also for a book finished by the 98% rule or with no parsed text.
  readonly percent: number;
  readonly status: keyof typeof readingBadge;
  readonly badge: { readonly label: string; readonly className: string };
  readonly isClippedAtStart: boolean;
  readonly seriesId?: string;
  readonly series?: {
    readonly id: string;
    readonly name: string;
    readonly place: number;
    readonly count: number;
  };
}

export interface Shelf {
  readonly items: ReadonlyArray<
    Shelf["series"][number] | { readonly kind: "book"; readonly card: LibraryCard }
  >;
  // Every series with a book in the library, also one of a single book, whatever the search.
  readonly series: ReadonlyArray<{
    readonly kind: "series";
    readonly id: string;
    readonly name: string;
    readonly books: ReadonlyArray<LibraryCard>;
    readonly inProgress: LibraryCard | null;
    readonly count: number;
    readonly finishedCount: number;
    readonly status: LibraryCard["status"];
    // The oklch hue of its tray.
    readonly color: number;
    readonly cover?: string | undefined;
  }>;
  readonly cards: ReadonlyMap<string, LibraryCard>;
  readonly matching: number;
  readonly isFiltered: boolean;
  readonly chips: ReadonlyArray<{
    readonly group: FilterGroup;
    readonly chips: ReadonlyArray<{
      readonly value: string;
      readonly label: string;
      readonly count: number;
      readonly isActive: boolean;
    }>;
  }>;
}

// Light in the light theme and dark in the dark one (the --tray token), so the text on a tray stays legible.
export const seriesColors = [
  { name: "Rose", hue: 15 },
  { name: "Amber", hue: 75 },
  { name: "Green", hue: 145 },
  { name: "Teal", hue: 195 },
  { name: "Blue", hue: 250 },
  { name: "Violet", hue: 300 },
] as const;

// A series derived from a name has this id, so the reader's edit of it stores a record with the same id.
export function seriesKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
}

interface SeriesGroup {
  id: string;
  name: string;
  bookIds: Array<string>;
  storedCount: number;
  color?: number;
  cover?: string;
}

interface ShelfState {
  readonly books: ReadonlyArray<BookMeta>;
  readonly reading: ReadonlyMap<string, ReadingProgress | null>;
  readonly leads: ReadonlyMap<string, string>;
  readonly marked: ReadonlySet<string>;
  readonly titleNames: ReadonlyMap<string, string>;
  readonly removedBySeries: ReadonlyMap<string, ReadonlySet<string>>;
  readonly booksById: ReadonlyMap<string, BookMeta>;
  readonly seriesGroups: Map<string, SeriesGroup>;
  readonly groupedBooks: Set<string>;
  readonly storedNumberByBook: Map<string, number>;
  readonly numberByBook: Map<string, number>;
  readonly titleClip: Set<string>;
  readonly seriesForBook: Map<
    string,
    {
      readonly id: string;
      readonly name: string;
      readonly place: number;
      readonly count: number;
      readonly isClippedAtStart: boolean;
    }
  >;
  readonly cardsById: Map<string, LibraryCard>;
}

export function buildShelf(
  books: ReadonlyArray<BookMeta>,
  reading: ReadonlyMap<string, ReadingProgress | null>,
  query: string,
  filters: Filters,
  sort: LibrarySort,
  storedSeries: ReadonlyArray<Series> = [],
): Shelf {
  const terms = query
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");
  const searched = searchBooks(books, terms);
  const { leads, marked, titleNames } = seriesLeads(books);
  const state: ShelfState = {
    books,
    reading,
    leads,
    marked,
    titleNames,
    removedBySeries: removedSeriesMap(storedSeries),
    booksById: new Map(books.map((book) => [book.id, book])),
    seriesGroups: new Map(),
    groupedBooks: new Set(),
    storedNumberByBook: new Map(),
    numberByBook: new Map(),
    titleClip: new Set(),
    seriesForBook: new Map(),
    cardsById: new Map(),
  };
  const collate = { numeric: true, sensitivity: "base" } as const;
  const titleCompare = (a: string, b: string): number => a.localeCompare(b, undefined, collate);

  collectStoredGroups(state, storedSeries);
  collectDerivedGroups(state);
  addTitleClips(state);
  orderGroups(state, titleCompare);
  collectSeriesForBook(state);

  const { cardsById, matches, facet, filterGroups, lastRead, shown } = libraryCards(
    state,
    searched,
    filters,
    sort,
    titleCompare,
  );
  const { allSeries, items } = shelfItems({
    state,
    query,
    filters,
    filterGroups,
    shown,
    lastRead,
    sort,
    titleCompare,
  });

  return {
    items,
    series: allSeries,
    cards: cardsById,
    matching: searched.length,
    isFiltered: filterGroups.some((group) => filters[group] !== null),
    chips: filterChips({ books, searched, matches, facet, filters }),
  };
}

function searchBooks(
  books: ReadonlyArray<BookMeta>,
  terms: ReadonlyArray<string>,
): ReadonlyArray<BookMeta> {
  return books.filter((book) => {
    const haystack = [book.title, book.author, book.subject, book.keywords, book.fileName]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

function seriesLeads(books: ReadonlyArray<BookMeta>): {
  readonly leads: Map<string, string>;
  readonly marked: Set<string>;
  readonly titleNames: Map<string, string>;
} {
  // A volume number ("Vol. 3", "#4") is strong, so its lead needs 2 books. A 3-word start needs 4.
  const leads = new Map<string, string>();
  const marked = new Set<string>();

  for (const book of books) {
    const { lead, isMarked } = bookLead(book);

    leads.set(book.id, lead);
    if (isMarked) marked.add(lead);
  }

  const leadCounts = countLeads(leads);
  const titleStarts = commonTitleStarts(books, leads, marked, leadCounts);
  const titleNames = new Map([...titleStarts].map(([lead, start]) => [lead, titleNameOf(start)]));

  return { leads, marked, titleNames };
}

function bookLead(book: BookMeta): { readonly lead: string; readonly isMarked: boolean } {
  const words = book.title
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");
  const last = words[words.length - 1] ?? "";
  const number = last.startsWith("#") ? last.slice(1) : last;
  const marker =
    number === "" || !Number.isFinite(Number(number))
      ? 0
      : last.startsWith("#")
        ? 1
        : ["vol", "vol.", "volume", "v.", "book", "part", "no.", "#"].includes(
              words[words.length - 2] ?? "",
            )
          ? 2
          : 0;

  if (marker === 0 || words.length <= marker) {
    return { lead: words.slice(0, 3).join(" "), isMarked: false };
  }

  return { lead: words.slice(0, -marker).join(" "), isMarked: true };
}

function countLeads(leads: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const lead of leads.values()) counts.set(lead, (counts.get(lead) ?? 0) + 1);

  return counts;
}

function commonTitleStarts(
  books: ReadonlyArray<BookMeta>,
  leads: ReadonlyMap<string, string>,
  marked: ReadonlySet<string>,
  leadCounts: ReadonlyMap<string, number>,
): Map<string, string> {
  const starts = new Map<string, string>();

  for (const book of books) {
    const lead = leads.get(book.id) ?? "";

    if (lead === "" || (leadCounts.get(lead) ?? 0) < (marked.has(lead) ? 2 : 4)) continue;

    const start = starts.get(lead) ?? book.title;
    let end = 0;

    while (end < start.length && start[end] === book.title[end]) end += 1;
    starts.set(lead, start.slice(0, end));
  }

  return starts;
}

function titleNameOf(start: string): string {
  const whole = start.endsWith(" ") ? start : start.slice(0, start.lastIndexOf(" ") + 1);
  const kept = whole.split(" ").filter((word) => word !== "");

  while (
    kept.length > 0 &&
    ["vol", "vol.", "volume", "v.", "book", "part", "#", "-", "–", "—", ":"].includes(
      (kept[kept.length - 1] ?? "").toLowerCase(),
    )
  ) {
    kept.pop();
  }

  let name = kept.join(" ");

  while (name.length > 0 && ":-–—,.(".includes(name[name.length - 1] ?? "")) {
    name = name.slice(0, -1);
  }

  return name || start;
}

function removedSeriesMap(storedSeries: ReadonlyArray<Series>): Map<string, ReadonlySet<string>> {
  const removedBySeries = new Map<string, Set<string>>();

  for (const series of storedSeries) {
    const id = seriesKey(series.id);
    const removed = removedBySeries.get(id) ?? new Set<string>();

    for (const bookId of series.removed) removed.add(bookId);
    removedBySeries.set(id, removed);
  }

  return removedBySeries;
}

function collectStoredGroups(state: ShelfState, storedSeries: ReadonlyArray<Series>): void {
  const storedByPriority = [...storedSeries].sort(
    (a, b) => Number(b.edited === true) - Number(a.edited === true) || a.id.localeCompare(b.id),
  );

  for (const series of storedByPriority) {
    if (series.hidden === true) continue;

    const id = seriesKey(series.id);

    if (id === "") continue;

    const group = state.seriesGroups.get(id) ?? {
      id: series.id,
      name: series.name,
      bookIds: [],
      storedCount: 0,
      color: series.color,
      cover: series.cover,
    };

    for (const entry of series.books) {
      if (
        !state.booksById.has(entry.id) ||
        state.groupedBooks.has(entry.id) ||
        state.removedBySeries.get(id)?.has(entry.id)
      ) {
        continue;
      }

      group.bookIds.push(entry.id);
      state.groupedBooks.add(entry.id);

      const number = entry.number ?? state.booksById.get(entry.id)?.seriesNumber;

      if (number !== undefined && Number.isFinite(number))
        state.storedNumberByBook.set(entry.id, number);
    }

    group.storedCount = group.bookIds.length;
    state.seriesGroups.set(id, group);
  }
}

function collectDerivedGroups(state: ShelfState): void {
  for (const book of state.books) {
    if (state.groupedBooks.has(book.id)) continue;

    const epubName = book.series?.trim() || undefined;
    const lead = state.leads.get(book.id) ?? "";
    const titleName = state.titleNames.get(lead);
    const candidates: Array<{ id: string; name: string; number: number | undefined }> = [];

    if (epubName !== undefined) {
      candidates.push({ id: seriesKey(epubName), name: epubName, number: book.seriesNumber });
    }

    if (titleName !== undefined) {
      candidates.push({ id: seriesKey(titleName), name: titleName, number: undefined });
    }

    const candidate = candidates.find(
      (entry) => entry.id !== "" && !state.removedBySeries.get(entry.id)?.has(book.id),
    );

    if (candidate === undefined) continue;

    const group = state.seriesGroups.get(candidate.id) ?? {
      id: candidate.id,
      name: candidate.name,
      bookIds: [],
      storedCount: 0,
    };

    group.bookIds.push(book.id);
    state.seriesGroups.set(candidate.id, group);
    state.groupedBooks.add(book.id);

    if (candidate.number !== undefined && Number.isFinite(candidate.number)) {
      state.numberByBook.set(book.id, candidate.number);
    }
  }
}

function addTitleClips(state: ShelfState): void {
  // A title-start series keeps its clipped titles after the reader saves it as a record.
  for (const [id, group] of state.seriesGroups) {
    for (const bookId of group.bookIds) {
      const lead = state.leads.get(bookId) ?? "";
      const titleName = state.titleNames.get(lead);

      if (titleName !== undefined && seriesKey(titleName) === id) state.titleClip.add(bookId);
    }
  }
}

function orderGroups(state: ShelfState, titleCompare: (a: string, b: string) => number): void {
  for (const group of state.seriesGroups.values()) {
    const storedBooks = group.bookIds.slice(0, group.storedCount);
    const derivedBooks = group.bookIds.slice(group.storedCount);

    derivedBooks.sort((a, b) => {
      const numberA = state.numberByBook.get(a);
      const numberB = state.numberByBook.get(b);

      if (numberA !== undefined && numberB !== undefined && numberA !== numberB) {
        return numberA - numberB;
      }
      if (numberA !== undefined && numberB === undefined) return -1;
      if (numberA === undefined && numberB !== undefined) return 1;

      return titleCompare(state.booksById.get(a)?.title ?? "", state.booksById.get(b)?.title ?? "");
    });

    for (const id of derivedBooks) {
      const number = state.numberByBook.get(id);
      const place =
        number === undefined
          ? -1
          : storedBooks.findIndex((storedId) => {
              const storedNumber = state.storedNumberByBook.get(storedId);
              return storedNumber !== undefined && storedNumber > number;
            });

      if (place === -1) storedBooks.push(id);
      else storedBooks.splice(place, 0, id);
    }

    group.bookIds = storedBooks;
  }
}

function collectSeriesForBook(state: ShelfState): void {
  for (const group of state.seriesGroups.values()) {
    group.bookIds.forEach((id, index) => {
      state.seriesForBook.set(id, {
        id: group.id,
        name: group.name,
        place: index + 1,
        count: group.bookIds.length,
        isClippedAtStart: state.titleClip.has(id),
      });
    });
  }
}

function libraryCards(
  state: ShelfState,
  searched: ReadonlyArray<BookMeta>,
  filters: Filters,
  sort: LibrarySort,
  titleCompare: (a: string, b: string) => number,
): {
  readonly cardsById: Map<string, LibraryCard>;
  readonly matches: (book: BookMeta, except?: FilterGroup) => boolean;
  readonly facet: Record<FilterGroup, (book: BookMeta) => string>;
  readonly filterGroups: ReadonlyArray<FilterGroup>;
  readonly lastRead: (book: BookMeta) => number;
  readonly shown: ReadonlyArray<BookMeta>;
} {
  const percentOf = (book: BookMeta): number => state.reading.get(book.id)?.percent ?? 0;
  const statusOf = (book: BookMeta): LibraryCard["status"] => {
    const progress = state.reading.get(book.id);
    const percent = percentOf(book);

    if (progress?.finished === true) return "finished";
    if (progress?.finished !== false && percent >= FINISHED_PERCENT) return "finished";
    if (percent > 0) return "reading";

    return "not-started";
  };
  const facet: Record<FilterGroup, (book: BookMeta) => string> = {
    status: statusOf,
    length: (book) => {
      if (book.pageCount < 150) return "short";
      if (book.pageCount <= 400) return "medium";

      return "long";
    },
    author: (book) => book.author ?? "",
  };
  const filterGroups = Object.keys(facet) as Array<FilterGroup>;
  // A chip's count keeps every other group's choice applied, so it counts the books a tap would show.
  const matches = (book: BookMeta, except?: FilterGroup): boolean =>
    filterGroups.every(
      (group) =>
        group === except || filters[group] === null || facet[group](book) === filters[group],
    );

  const lastRead = (book: BookMeta): number => state.reading.get(book.id)?.updatedAt ?? 0;
  const shown = searched.filter((book) => matches(book));

  shown.sort((a, b) => {
    if (sort === "added") return b.addedAt - a.addedAt;
    if (sort === "title") return titleCompare(a.title, b.title);

    return lastRead(b) - lastRead(a) || b.addedAt - a.addedAt;
  });

  for (const book of state.books) {
    const status = statusOf(book);
    const ready = book.parseState === "ready";
    const series = state.seriesForBook.get(book.id);

    state.cardsById.set(book.id, {
      book,
      percent: status === "finished" ? 1 : percentOf(book),
      status,
      badge: ready ? readingBadge[status] : parseStateBadge[book.parseState],
      isClippedAtStart: series?.isClippedAtStart ?? false,
      ...(series === undefined ? {} : { seriesId: series.id }),
      ...(series === undefined || series.count < 2
        ? {}
        : {
            series: {
              id: series.id,
              name: series.name,
              place: series.place,
              count: series.count,
            },
          }),
    });
  }

  return { cardsById: state.cardsById, matches, facet, filterGroups, lastRead, shown };
}

function shelfItems({
  state,
  query,
  filters,
  filterGroups,
  shown,
  lastRead,
  sort,
  titleCompare,
}: {
  readonly state: ShelfState;
  readonly query: string;
  readonly filters: Filters;
  readonly filterGroups: ReadonlyArray<FilterGroup>;
  readonly shown: ReadonlyArray<BookMeta>;
  readonly lastRead: (book: BookMeta) => number;
  readonly sort: LibrarySort;
  readonly titleCompare: (a: string, b: string) => number;
}): {
  readonly allSeries: Shelf["series"];
  readonly items: Shelf["items"];
} {
  const grouped = [...state.seriesGroups.values()].flatMap((group) => {
    const cards = group.bookIds.flatMap((id) => {
      const card = state.cardsById.get(id);
      return card === undefined ? [] : [card];
    });

    if (cards.length === 0) return [];

    const inProgress =
      cards
        .filter((card) => card.status === "reading")
        .sort((a, b) => lastRead(b.book) - lastRead(a.book))[0] ?? null;
    const finishedCount = cards.filter((card) => card.status === "finished").length;
    const status: LibraryCard["status"] =
      inProgress !== null ? "reading" : finishedCount === cards.length ? "finished" : "not-started";

    return [
      {
        kind: "series" as const,
        id: group.id,
        name: group.name,
        books: cards,
        inProgress,
        count: cards.length,
        finishedCount,
        status,
        chosenColor: group.color,
        cover: group.cover,
      },
    ];
  });
  // Oldest book first, so a new series keeps the colours of the older ones.
  const turns = grouped
    .filter((group) => group.count >= 2)
    .map((group) => ({
      id: group.id,
      added: Math.min(...group.books.map((card) => card.book.addedAt)),
    }))
    .sort((a, b) => a.added - b.added || a.id.localeCompare(b.id))
    .map((group) => group.id);
  const allSeries = grouped.map(({ chosenColor, ...group }) => ({
    ...group,
    color:
      chosenColor ??
      seriesColors[Math.max(0, turns.indexOf(group.id)) % seriesColors.length]?.hue ??
      250,
  }));
  const seriesItems = allSeries.filter((item) => item.count >= 2);
  const singleItems = state.books
    .filter((book) => (state.seriesForBook.get(book.id)?.count ?? 0) < 2)
    .flatMap((book) => {
      const card = state.cardsById.get(book.id);
      return card === undefined ? [] : [{ kind: "book" as const, card }];
    });
  const isFiltered = filterGroups.some((group) => filters[group] !== null);
  const items =
    query.trim() !== "" || isFiltered
      ? shown.flatMap((book) => {
          const card = state.cardsById.get(book.id);
          return card === undefined ? [] : [{ kind: "book" as const, card }];
        })
      : [...seriesItems, ...singleItems];

  items.sort((a, b) => {
    const titleA = a.kind === "series" ? a.name : a.card.book.title;
    const titleB = b.kind === "series" ? b.name : b.card.book.title;

    if (sort === "title") return titleCompare(titleA, titleB);

    const cardsA = a.kind === "series" ? a.books : [a.card];
    const cardsB = b.kind === "series" ? b.books : [b.card];
    const addedA = Math.max(...cardsA.map((card) => card.book.addedAt));
    const addedB = Math.max(...cardsB.map((card) => card.book.addedAt));

    if (sort === "added") return addedB - addedA || titleCompare(titleA, titleB);

    const readA = Math.max(...cardsA.map((card) => lastRead(card.book)));
    const readB = Math.max(...cardsB.map((card) => lastRead(card.book)));

    return readB - readA || addedB - addedA || titleCompare(titleA, titleB);
  });

  return { allSeries, items };
}

function filterChips({
  books,
  searched,
  matches,
  facet,
  filters,
}: {
  readonly books: ReadonlyArray<BookMeta>;
  readonly searched: ReadonlyArray<BookMeta>;
  readonly matches: (book: BookMeta, except?: FilterGroup) => boolean;
  readonly facet: Record<FilterGroup, (book: BookMeta) => string>;
  readonly filters: Filters;
}): Shelf["chips"] {
  const options: Array<{ group: FilterGroup; options: ReadonlyArray<readonly [string, string]> }> =
    [
      {
        group: "status",
        options: [
          ["reading", "Reading"],
          ["not-started", "Not started"],
          ["finished", "Finished"],
        ],
      },
    ];

  options.push({
    group: "length",
    options: [
      ["short", "Under 150 pages"],
      ["medium", "150 to 400 pages"],
      ["long", "Over 400 pages"],
    ],
  });

  const authors = [...new Set(books.map((book) => book.author ?? ""))].sort();

  if (authors.length > 1) {
    options.push({
      group: "author",
      options: authors.map((author) => [author, author || "Unknown author"] as const),
    });
  }

  return options.map(({ group, options: groupOptions }) => ({
    group,
    chips: groupOptions
      .map(([value, label]) => ({
        value,
        label,
        count: searched.filter((book) => matches(book, group) && facet[group](book) === value)
          .length,
        isActive: filters[group] === value,
      }))
      .filter((chip) => chip.count > 0 || chip.isActive),
  }));
}
