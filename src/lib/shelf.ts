import type { BookMeta, LibrarySort, ReadingProgress } from "@/domain/book";
import { parseStateBadge, readingBadge } from "@/lib/badges";

export type FilterGroup = "status" | "series" | "length" | "author";
export type Filters = Readonly<Record<FilterGroup, string | null>>;

export interface LibraryCard {
  readonly book: BookMeta;
  readonly percent: number;
  readonly status: keyof typeof readingBadge;
  readonly badge: { readonly label: string; readonly className: string };
  readonly clipStart: boolean;
}

export interface FilterChip {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
}

export interface Shelf {
  readonly cards: ReadonlyArray<LibraryCard>;
  readonly matching: number;
  readonly filtered: boolean;
  readonly chips: ReadonlyArray<{
    readonly group: FilterGroup;
    readonly chips: ReadonlyArray<FilterChip>;
  }>;
}

const words = (text: string): Array<string> =>
  text
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");

export function buildShelf(
  books: ReadonlyArray<BookMeta>,
  reading: ReadonlyMap<string, ReadingProgress | null>,
  query: string,
  filters: Filters,
  sort: LibrarySort,
): Shelf {
  const terms = words(query);
  const searched = books.filter((book) => {
    const haystack = [book.title, book.author, book.subject, book.keywords, book.fileName]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  // Volumes of one series open with the same words; more than 3 books sharing three words is a series.
  const leads = new Map(books.map((book) => [book.id, words(book.title).slice(0, 3).join(" ")]));
  const leadCounts = new Map<string, number>();
  for (const lead of leads.values()) leadCounts.set(lead, (leadCounts.get(lead) ?? 0) + 1);
  const seriesOf = (book: BookMeta): string => {
    const lead = leads.get(book.id) ?? "";
    return (leadCounts.get(lead) ?? 0) > 3 ? lead : "";
  };

  const percentOf = (book: BookMeta): number => reading.get(book.id)?.percent ?? 0;
  const statusOf = (book: BookMeta): LibraryCard["status"] => {
    const percent = percentOf(book);
    if (percent >= 0.98) return "finished";
    if (percent > 0) return "reading";
    return "not-started";
  };
  const facet: Record<FilterGroup, (book: BookMeta) => string> = {
    status: statusOf,
    series: seriesOf,
    length: (book) => {
      if (book.pageCount < 150) return "short";
      if (book.pageCount <= 400) return "medium";
      return "long";
    },
    author: (book) => book.author ?? "",
  };
  const groups = Object.keys(facet) as Array<FilterGroup>;
  // A chip's count keeps every other group's choice applied, so it says how many books a tap leaves.
  const matches = (book: BookMeta, except?: FilterGroup): boolean =>
    groups.every(
      (group) =>
        group === except || filters[group] === null || facet[group](book) === filters[group],
    );

  const lastRead = (book: BookMeta): number => reading.get(book.id)?.updatedAt ?? 0;
  // Numeric collation puts "Vol. 2" before "Vol. 10".
  const collate = { numeric: true, sensitivity: "base" } as const;
  const shown = searched.filter((book) => matches(book));
  shown.sort((a, b) => {
    if (sort === "added") return b.addedAt - a.addedAt;
    if (sort === "title") return a.title.localeCompare(b.title, undefined, collate);
    return lastRead(b) - lastRead(a) || b.addedAt - a.addedAt;
  });

  const cards = shown.map((book): LibraryCard => {
    const status = statusOf(book);
    const ready = book.parseState === "ready";
    return {
      book,
      percent: percentOf(book),
      status,
      badge: ready ? readingBadge[status] : parseStateBadge[book.parseState],
      clipStart: seriesOf(book) !== "",
    };
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
  const seriesNames = nameSeries(books, seriesOf);
  if (seriesNames.length > 0) options.push({ group: "series", options: seriesNames });
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
    cards,
    matching: searched.length,
    filtered: groups.some((group) => filters[group] !== null),
    chips,
  };
}

// Names a series by its shared title start, minus a trailing "Vol." or punctuation.
function nameSeries(
  books: ReadonlyArray<BookMeta>,
  seriesOf: (book: BookMeta) => string,
): Array<readonly [string, string]> {
  const shared = new Map<string, string>();
  for (const book of books) {
    const series = seriesOf(book);
    if (series === "") continue;
    const start = shared.get(series) ?? book.title;
    let end = 0;
    while (end < start.length && start[end] === book.title[end]) end += 1;
    shared.set(series, start.slice(0, end));
  }

  const filler = ["vol", "vol.", "volume", "v.", "book", "part", "#", "-", "–", "—", ":"];
  return [...shared].map(([series, start]) => {
    const whole = start.endsWith(" ") ? start : start.slice(0, start.lastIndexOf(" ") + 1);
    const kept = whole.split(" ").filter((word) => word !== "");
    while (kept.length > 0 && filler.includes((kept[kept.length - 1] ?? "").toLowerCase())) {
      kept.pop();
    }
    let name = kept.join(" ");
    while (name.length > 0 && ":-–—,.(".includes(name[name.length - 1] ?? "")) {
      name = name.slice(0, -1);
    }
    return [series, name || series] as const;
  });
}
