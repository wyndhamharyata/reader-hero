import { Effect, Stream } from "effect";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowsUpDownIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Squares2x2Icon,
} from "@/components/icons";
import {
  forkApp,
  runApp,
  stopFiber,
  useAppEffect,
  useFigureJobs,
  useSettings,
  type Job,
} from "@/lib/hooks";
import type { BookMeta, LibrarySort } from "@/domain/book";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { BookStore } from "@/services/book-store";
import { ensureCovers } from "@/use-cases/book-image";
import type { ParseProgress } from "@/use-cases/extract";
import { importPdfs } from "@/use-cases/import-pdfs";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";
import { BookCard } from "./_BookCard";
import { ProgressPanel } from "./_ProgressPanel";
import { InstallHint } from "./_InstallHint";
import { LibraryStatus } from "./_LibraryStatus";
import { LibraryTitle } from "./_LibraryTitle";
import { StorageUsage } from "./_StorageUsage";

const showInstallHint = isIosBrowser && !isInstalled;

export function LibraryRoute() {
  const { state, reload } = useAppEffect(
    Effect.gen(function* () {
      const store = yield* BookStore;
      const books = yield* store.list();
      const estimate = yield* store.estimate();
      const reading = yield* Effect.forEach(
        books,
        (book) =>
          store.getProgress(book.id).pipe(Effect.map((progress) => [book.id, progress] as const)),
        { concurrency: "unbounded" },
      );
      return { books, estimate, reading: new Map(reading) };
    }),
    [],
  );

  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const importJob = useRef<Job | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<
    Record<"status" | "series" | "length" | "author", string | null>
  >({
    status: null,
    series: null,
    length: null,
    author: null,
  });
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;
  const reading = state.status === "done" ? state.value.reading : null;
  useFigureJobs(books);
  const grid = settings.libraryView === "grid";
  // Keyed on the ids, so the frequent meta reloads during parsing do not restart the cover job.
  const bookIds = books.map((book) => book.id).join(" ");

  useEffect(() => {
    if (bookIds === "") return;
    const fiber = forkApp(ensureCovers(bookIds.split(" ")));
    return () => stopFiber(fiber);
  }, [bookIds]);

  useEffect(() => {
    const program = importInboxOnce().pipe(
      Effect.tap((count) =>
        Effect.sync(() => {
          if (count > 0) reload();
        }),
      ),
    );
    void runApp(program);
  }, [reload]);

  useEffect(() => {
    const fiber = forkApp(
      Effect.gen(function* () {
        const store = yield* BookStore;
        yield* store.updates().pipe(
          Stream.filter((update) => update.kind === "meta"),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [reload]);

  const importFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setBusy(true);
    setImporting(true);
    setMessage(null);
    // Runs on cancel too: a cancelled file is removed without a meta update, so reload here.
    const settle = Effect.sync(() => {
      setBusy(false);
      setImporting(false);
      setProgress(null);
      importJob.current = null;
      reload();
    });
    importJob.current = forkApp(
      importPdfs(files, setProgress, setMessage).pipe(Effect.ensuring(settle)),
    );
  };

  const cancelImport = () => {
    if (importJob.current !== null) stopFiber(importJob.current);
  };

  const remove = (id: string) => {
    void runApp(removeBook(id).pipe(Effect.tap(() => Effect.sync(() => reload()))));
  };

  const reparse = (id: string) => {
    setBusy(true);
    setMessage(null);
    const settle = Effect.sync(() => {
      setBusy(false);
      setProgress(null);
    });
    const program = reparseBook(id, setProgress, setMessage).pipe(
      Effect.ensuring(settle),
      Effect.tap(() => Effect.sync(() => reload())),
    );
    void runApp(program);
  };

  const actionLabel = busy ? "Working…" : "Add PDF";

  // Every word must appear somewhere in the book's searchable fields, so "tensei 7" finds volume 7.
  const terms = query
    .toLowerCase()
    .split(" ")
    .filter((term) => term !== "");
  const searched =
    terms.length === 0
      ? books
      : books.filter((book) => {
          const haystack = [book.title, book.author, book.subject, book.keywords, book.fileName]
            .join(" ")
            .toLowerCase();
          return terms.every((term) => haystack.includes(term));
        });

  // Volumes of one series share their opening words, so their titles all cut off the same way. When
  // more than 3 books open with the same three words, the card cuts the start instead.
  const leads = new Map(
    books.map((book) => [
      book.id,
      book.title
        .toLowerCase()
        .split(" ")
        .filter((word) => word !== "")
        .slice(0, 3)
        .join(" "),
    ]),
  );
  const leadCounts = new Map<string, number>();
  for (const lead of leads.values()) leadCounts.set(lead, (leadCounts.get(lead) ?? 0) + 1);
  const seriesOf = (book: BookMeta) => {
    const lead = leads.get(book.id) ?? "";
    return (leadCounts.get(lead) ?? 0) > 3 ? lead : "";
  };

  // A series is named by the start its titles share, cut back to whole words and stripped of a
  // trailing "Vol." or punctuation: "Mushoku Tensei: Jobless Reincarnation".
  const seriesShared = new Map<string, string>();
  for (const book of books) {
    const series = seriesOf(book);
    if (series === "") continue;
    const shared = seriesShared.get(series) ?? book.title;
    let end = 0;
    while (end < shared.length && shared[end] === book.title[end]) end += 1;
    seriesShared.set(series, shared.slice(0, end));
  }
  const seriesOptions = [...seriesShared].map(([series, shared]) => {
    const words = (shared.endsWith(" ") ? shared : shared.slice(0, shared.lastIndexOf(" ") + 1))
      .split(" ")
      .filter((word) => word !== "");
    const filler = ["vol", "vol.", "volume", "v.", "book", "part", "#", "-", "–", "—", ":"];
    while (words.length > 0 && filler.includes((words[words.length - 1] ?? "").toLowerCase())) {
      words.pop();
    }
    let name = words.join(" ");
    while (name.length > 0 && ":-–—,.(".includes(name[name.length - 1] ?? ""))
      name = name.slice(0, -1);
    return [series, name || series] as const;
  });

  // One choice per filter group. A chip's count keeps every other group's choice applied, so it
  // says how many books a tap would leave.
  const facet = {
    status: (book: BookMeta) => {
      const percent = reading?.get(book.id)?.percent ?? 0;
      return percent >= 0.98 ? "finished" : percent > 0 ? "reading" : "not-started";
    },
    series: seriesOf,
    length: (book: BookMeta) =>
      book.pageCount < 150 ? "short" : book.pageCount <= 400 ? "medium" : "long",
    author: (book: BookMeta) => book.author ?? "",
  };
  const groups = Object.keys(facet) as Array<keyof typeof facet>;
  const matches = (book: BookMeta, except?: keyof typeof facet) =>
    groups.every(
      (group) =>
        group === except || filters[group] === null || facet[group](book) === filters[group],
    );
  const lastRead = (book: BookMeta) => reading?.get(book.id)?.updatedAt ?? 0;
  // Titles compare with numeric order, so "Vol. 2" comes before "Vol. 10".
  const collate = { numeric: true, sensitivity: "base" } as const;
  const shown = searched
    .filter((book) => matches(book))
    .sort((a, b) => {
      switch (settings.librarySort) {
        case "added":
          return b.addedAt - a.addedAt;
        case "title":
          return a.title.localeCompare(b.title, undefined, collate);
        default:
          // Recently read first; books never opened follow, newest import first.
          return lastRead(b) - lastRead(a) || b.addedAt - a.addedAt;
      }
    });

  const sorts: ReadonlyArray<readonly [LibrarySort, string]> = [
    ["recent", "Recently read"],
    ["added", "Recently added"],
    ["title", "Title A–Z"],
  ];
  const sortLabel = sorts.find(([value]) => value === settings.librarySort)?.[1] ?? "Sort";
  // Opens upward from the phone's bottom bar and downward from the desktop header. The trigger is a
  // focusable div because Safari does not focus a tapped <button>, and the dropdown opens on focus.
  const sortControl = (
    <div className="dropdown dropdown-top md:dropdown-end md:dropdown-bottom">
      <div
        tabIndex={0}
        role="button"
        className="btn max-lg:btn-square md:btn-sm"
        aria-label={`Sort: ${sortLabel}`}
      >
        <ArrowsUpDownIcon className="size-5 md:size-4" />
        <span className="hidden lg:inline">{sortLabel}</span>
      </div>
      <ul
        tabIndex={0}
        className="menu dropdown-content z-50 w-48 rounded-box bg-base-100 p-1 shadow-lg"
      >
        {sorts.map(([value, label]) => (
          <li key={value}>
            <button
              type="button"
              className={value === settings.librarySort ? "menu-active" : ""}
              onClick={() => {
                update({ librarySort: value });
                (document.activeElement as HTMLElement | null)?.blur();
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const authors = [...new Set(books.map((book) => book.author ?? ""))].sort();
  const chipGroups: ReadonlyArray<{
    group: keyof typeof facet;
    options: ReadonlyArray<readonly [string, string]>;
  }> = [
    {
      group: "status",
      options: [
        ["reading", "Reading"],
        ["not-started", "Not started"],
        ["finished", "Finished"],
      ],
    },
    ...(seriesOptions.length > 0 ? [{ group: "series" as const, options: seriesOptions }] : []),
    {
      group: "length",
      options: [
        ["short", "Under 150 pages"],
        ["medium", "150–400 pages"],
        ["long", "Over 400 pages"],
      ],
    },
    ...(authors.length > 1
      ? [
          {
            group: "author" as const,
            options: authors.map((author) => [author, author || "Unknown author"] as const),
          },
        ]
      : []),
  ];
  const filtered = groups.some((group) => filters[group] !== null);
  const clearFilters = () => setFilters({ status: null, series: null, length: null, author: null });
  const chip = "btn btn-sm shrink-0 rounded-full";
  const idleChip = `${chip} btn-ghost border-base-300`;

  const filterChips = (
    <div className="-mx-4 flex touch-pan-x [scrollbar-width:none] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 md:mx-0 md:flex-wrap md:px-0">
      <button
        type="button"
        className={filtered ? idleChip : `${chip} btn-primary`}
        aria-pressed={!filtered}
        onClick={clearFilters}
      >
        All <span className="opacity-70">{searched.length}</span>
      </button>
      {chipGroups.map(({ group, options }) => (
        <Fragment key={group}>
          <span className="my-1 w-px shrink-0 bg-base-300" aria-hidden="true" />
          {options.map(([value, label]) => {
            const active = filters[group] === value;
            const count = searched.filter(
              (book) => matches(book, group) && facet[group](book) === value,
            ).length;
            if (count === 0 && !active) return null;
            return (
              <button
                key={value}
                type="button"
                className={active ? `${chip} btn-primary` : idleChip}
                aria-pressed={active}
                onClick={() =>
                  setFilters((current) => ({ ...current, [group]: active ? null : value }))
                }
              >
                {label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );

  // 16px text on phones: iOS zooms the page into any focused input smaller than that.
  const searchField = (
    <label className="input w-full text-base md:w-64 md:text-sm">
      <MagnifyingGlassIcon className="size-5 opacity-50 md:size-4" />
      <input
        type="search"
        className="grow"
        placeholder="Search title, author…"
        aria-label="Search books"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  const viewToggle = (
    <div className="join">
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${grid ? "btn-ghost" : "btn-active"}`}
        aria-label="List view"
        aria-pressed={!grid}
        onClick={() => update({ libraryView: "list" })}
      >
        <ListBulletIcon className="size-5 md:size-4" />
      </button>
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${grid ? "btn-active" : "btn-ghost"}`}
        aria-label="Grid view"
        aria-pressed={grid}
        onClick={() => update({ libraryView: "grid" })}
      >
        <Squares2x2Icon className="size-5 md:size-4" />
      </button>
    </div>
  );

  return (
    <main className="mx-auto flex min-h-[var(--app-height)] w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] pb-[calc(var(--safe-bottom)+12rem)] md:max-w-5xl md:pb-8">
      <header className="flex items-center justify-between gap-3 pt-2">
        <LibraryTitle />
        <div className="flex items-center gap-2">
          <div className="hidden md:block">{searchField}</div>
          <div className="hidden md:block">{sortControl}</div>
          <div className="hidden md:block">{viewToggle}</div>
          <button
            type="button"
            className="btn hidden btn-primary btn-sm md:inline-flex"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <PlusIcon className="size-4" />
            {actionLabel}
          </button>
        </div>
      </header>

      <div className="hidden md:block">{filterChips}</div>

      {message !== null && (
        <div className="alert alert-warning">
          <span className="whitespace-pre-line">{message}</span>
        </div>
      )}

      <InstallHint show={showInstallHint} />

      <LibraryStatus
        loading={state.status === "loading"}
        failed={state.status === "error"}
        books={books}
      />

      <ul
        className={
          grid
            ? "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-5"
            : "grid grid-cols-1 gap-3 md:grid-cols-2"
        }
      >
        {shown.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            grid={grid}
            percent={reading?.get(book.id)?.percent ?? 0}
            status={facet.status(book)}
            clipStart={(leadCounts.get(leads.get(book.id) ?? "") ?? 0) > 3}
            onRemove={remove}
            onReparse={reparse}
          />
        ))}
      </ul>

      {shown.length === 0 && books.length > 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm">
          <p className="opacity-70">No books match your search and filters.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuery("");
              clearFilters();
            }}
          >
            Clear all
          </button>
        </div>
      )}

      <StorageUsage estimate={estimate} />

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-base-300 bg-base-100 px-4 pt-2 pb-[calc(var(--safe-bottom)+0.5rem)] md:hidden">
        {searchField}
        {filterChips}
        <div className="flex items-center gap-3">
          {viewToggle}
          {sortControl}
          <button
            type="button"
            className="btn flex-1 btn-primary"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {actionLabel}
          </button>
        </div>
      </div>

      {busy && (
        <ProgressPanel progress={progress} onCancel={importing ? cancelImport : undefined} />
      )}
    </main>
  );
}
