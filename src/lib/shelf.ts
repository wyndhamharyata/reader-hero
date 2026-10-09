import type { BookMeta, BookPrefs, LibrarySort, ReadingProgress, Series } from "@/domain/book";
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

export interface LibraryCard {
  readonly book: BookMeta;
  // 100% once the book is finished, also for a book finished by the 98% rule or with no parsed text.
  readonly percent: number;
  readonly status: keyof typeof readingBadge;
  readonly badge: { readonly label: string; readonly className: string };
  readonly clipStart: boolean;
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
  readonly filtered: boolean;
  readonly chips: ReadonlyArray<{
    readonly group: FilterGroup;
    readonly chips: ReadonlyArray<{
      readonly value: string;
      readonly label: string;
      readonly count: number;
      readonly active: boolean;
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
  const searched = books.filter((book) => {
    const haystack = [book.title, book.author, book.subject, book.keywords, book.fileName]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  // A title that ends in a volume number ("Vol. 3", "#4") leads with the words before it, and 2 such
  // books are a series; else more than 3 books that open with the same three words are.
  const marked = new Set<string>();
  const leads = new Map(
    books.map((book) => {
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
      if (marker === 0 || words.length <= marker) return [book.id, words.slice(0, 3).join(" ")];
      const lead = words.slice(0, -marker).join(" ");
      marked.add(lead);
      return [book.id, lead];
    }),
  );
  const leadCounts = new Map<string, number>();
  for (const lead of leads.values()) leadCounts.set(lead, (leadCounts.get(lead) ?? 0) + 1);

  const titleStarts = new Map<string, string>();
  for (const book of books) {
    const lead = leads.get(book.id) ?? "";
    if (lead === "" || (leadCounts.get(lead) ?? 0) < (marked.has(lead) ? 2 : 4)) continue;
    const start = titleStarts.get(lead) ?? book.title;
    let end = 0;
    while (end < start.length && start[end] === book.title[end]) end += 1;
    titleStarts.set(lead, start.slice(0, end));
  }
  const titleNames = new Map<string, string>();
  for (const [lead, start] of titleStarts) {
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
    titleNames.set(lead, name || lead);
  }

  const removedBySeries = new Map<string, Set<string>>();
  for (const series of storedSeries) {
    const id = seriesKey(series.id);
    const removed = removedBySeries.get(id) ?? new Set<string>();
    for (const bookId of series.removed) removed.add(bookId);
    removedBySeries.set(id, removed);
  }

  const booksById = new Map(books.map((book) => [book.id, book]));
  const seriesGroups = new Map<
    string,
    {
      id: string;
      name: string;
      bookIds: Array<string>;
      storedCount: number;
      color?: number;
      cover?: string;
    }
  >();
  const groupedBooks = new Set<string>();
  const storedNumberByBook = new Map<string, number>();
  const storedByPriority = [...storedSeries].sort(
    (a, b) => Number(b.edited === true) - Number(a.edited === true) || a.id.localeCompare(b.id),
  );
  for (const series of storedByPriority) {
    if (series.hidden === true) continue;
    const id = seriesKey(series.id);
    if (id === "") continue;
    const group = seriesGroups.get(id) ?? {
      id: series.id,
      name: series.name,
      bookIds: [],
      storedCount: 0,
      color: series.color,
      cover: series.cover,
    };
    for (const entry of series.books) {
      if (
        !booksById.has(entry.id) ||
        groupedBooks.has(entry.id) ||
        removedBySeries.get(id)?.has(entry.id)
      ) {
        continue;
      }
      group.bookIds.push(entry.id);
      groupedBooks.add(entry.id);
      const number = entry.number ?? booksById.get(entry.id)?.seriesNumber;
      if (number !== undefined && Number.isFinite(number)) storedNumberByBook.set(entry.id, number);
    }
    group.storedCount = group.bookIds.length;
    seriesGroups.set(id, group);
  }

  const numberByBook = new Map<string, number>();
  const titleClip = new Set<string>();
  for (const book of books) {
    if (groupedBooks.has(book.id)) continue;
    const epubName = book.series?.trim() || undefined;
    const lead = leads.get(book.id) ?? "";
    const titleName = titleNames.get(lead);
    const candidates = [
      ...(epubName === undefined
        ? []
        : [{ id: seriesKey(epubName), name: epubName, number: book.seriesNumber }]),
      ...(titleName === undefined
        ? []
        : [{ id: seriesKey(titleName), name: titleName, number: undefined }]),
    ];
    const candidate = candidates.find(
      (entry) => entry.id !== "" && !removedBySeries.get(entry.id)?.has(book.id),
    );
    if (candidate === undefined) continue;
    const group = seriesGroups.get(candidate.id) ?? {
      id: candidate.id,
      name: candidate.name,
      bookIds: [],
      storedCount: 0,
    };
    group.bookIds.push(book.id);
    seriesGroups.set(candidate.id, group);
    groupedBooks.add(book.id);
    if (candidate.number !== undefined && Number.isFinite(candidate.number)) {
      numberByBook.set(book.id, candidate.number);
    }
  }
  // A title-start series keeps its clipped titles after the reader saves it as a record.
  for (const [id, group] of seriesGroups) {
    for (const bookId of group.bookIds) {
      const lead = leads.get(bookId) ?? "";
      const titleName = titleNames.get(lead);
      if (titleName !== undefined && seriesKey(titleName) === id) titleClip.add(bookId);
    }
  }

  const collate = { numeric: true, sensitivity: "base" } as const;
  const titleCompare = (a: string, b: string): number => a.localeCompare(b, undefined, collate);
  for (const group of seriesGroups.values()) {
    const storedBooks = group.bookIds.slice(0, group.storedCount);
    const derivedBooks = group.bookIds.slice(group.storedCount);
    derivedBooks.sort((a, b) => {
      const numberA = numberByBook.get(a);
      const numberB = numberByBook.get(b);
      if (numberA !== undefined && numberB !== undefined && numberA !== numberB) {
        return numberA - numberB;
      }
      if (numberA !== undefined && numberB === undefined) return -1;
      if (numberA === undefined && numberB !== undefined) return 1;
      return titleCompare(booksById.get(a)?.title ?? "", booksById.get(b)?.title ?? "");
    });
    for (const id of derivedBooks) {
      const number = numberByBook.get(id);
      const place =
        number === undefined
          ? -1
          : storedBooks.findIndex((storedId) => {
              const storedNumber = storedNumberByBook.get(storedId);
              return storedNumber !== undefined && storedNumber > number;
            });
      if (place === -1) storedBooks.push(id);
      else storedBooks.splice(place, 0, id);
    }
    group.bookIds = storedBooks;
  }

  const seriesForBook = new Map<
    string,
    { id: string; name: string; place: number; count: number; clipStart: boolean }
  >();
  for (const group of seriesGroups.values()) {
    group.bookIds.forEach((id, index) => {
      seriesForBook.set(id, {
        id: group.id,
        name: group.name,
        place: index + 1,
        count: group.bookIds.length,
        clipStart: titleClip.has(id),
      });
    });
  }

  const percentOf = (book: BookMeta): number => reading.get(book.id)?.percent ?? 0;
  const statusOf = (book: BookMeta): LibraryCard["status"] => {
    const progress = reading.get(book.id);
    const percent = percentOf(book);
    if (progress?.finished === true) return "finished";
    if (progress?.finished !== false && percent >= 0.98) return "finished";
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
  // A chip's count keeps every other group's choice applied, so it says how many books a tap leaves.
  const matches = (book: BookMeta, except?: FilterGroup): boolean =>
    filterGroups.every(
      (group) =>
        group === except || filters[group] === null || facet[group](book) === filters[group],
    );

  const lastRead = (book: BookMeta): number => reading.get(book.id)?.updatedAt ?? 0;
  const shown = searched.filter((book) => matches(book));
  shown.sort((a, b) => {
    if (sort === "added") return b.addedAt - a.addedAt;
    if (sort === "title") return titleCompare(a.title, b.title);
    return lastRead(b) - lastRead(a) || b.addedAt - a.addedAt;
  });

  const cardsById = new Map<string, LibraryCard>();
  for (const book of books) {
    const status = statusOf(book);
    const ready = book.parseState === "ready";
    const series = seriesForBook.get(book.id);
    cardsById.set(book.id, {
      book,
      percent: status === "finished" ? 1 : percentOf(book),
      status,
      badge: ready ? readingBadge[status] : parseStateBadge[book.parseState],
      clipStart: series?.clipStart ?? false,
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

  const grouped = [...seriesGroups.values()].flatMap((group) => {
    const cards = group.bookIds.flatMap((id) => {
      const card = cardsById.get(id);
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
  // The palette goes round the series, oldest book first, so newer books that start a series leave
  // each older series its colour.
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
  const singleItems = books
    .filter((book) => (seriesForBook.get(book.id)?.count ?? 0) < 2)
    .flatMap((book) => {
      const card = cardsById.get(book.id);
      return card === undefined ? [] : [{ kind: "book" as const, card }];
    });
  const filtered = filterGroups.some((group) => filters[group] !== null);
  const items =
    query.trim() !== "" || filtered
      ? shown.flatMap((book) => {
          const card = cardsById.get(book.id);
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
      ["medium", "150–400 pages"],
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

  const chips = options.map(({ group, options: groupOptions }) => ({
    group,
    chips: groupOptions
      .map(([value, label]) => ({
        value,
        label,
        count: searched.filter((book) => matches(book, group) && facet[group](book) === value)
          .length,
        active: filters[group] === value,
      }))
      .filter((chip) => chip.count > 0 || chip.active),
  }));

  return {
    items,
    series: allSeries,
    cards: cardsById,
    matching: searched.length,
    filtered,
    chips,
  };
}
