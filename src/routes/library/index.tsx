import { Effect, Stream } from "effect";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CogIcon, FunnelIcon, PlusIcon } from "@/components/icons";
import {
  forkApp,
  runApp,
  stopFiber,
  useAppEffect,
  useFigureJobs,
  useSettings,
  type Job,
} from "@/lib/hooks";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { buildShelf, type FilterGroup, type Filters } from "@/lib/shelf";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { ensureCovers } from "@/use-cases/book-image";
import type { ParseProgress } from "@/use-cases/extract";
import { importBooks } from "@/use-cases/import-books";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";
import { describeError } from "@/lib/describe-error";
import { useKeyboardCover } from "@/lib/use-keyboard-cover";
import { BookCard } from "./_BookCard";
import { BookTile } from "./_BookTile";
import { FilterChips } from "./_FilterChips";
import { FilterSheet } from "./_FilterSheet";
import { ProgressPanel } from "./_ProgressPanel";
import { InstallHint } from "./_InstallHint";
import { LibraryStatus } from "./_LibraryStatus";
import { NoMatches } from "./_NoMatches";
import { Logo } from "./_Logo";
import { SearchField } from "./_SearchField";
import { SettingsSheet } from "./_SettingsSheet";
import { SortMenu } from "./_SortMenu";
import { StorageUsage } from "./_StorageUsage";
import { ViewToggle } from "./_ViewToggle";

const showInstallHint = isIosBrowser && !isInstalled;

export function LibraryRoute(): ReactElement {
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    status: null,
    series: null,
    length: null,
    author: null,
  });
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const coverRef = useRef<HTMLDivElement>(null);
  useKeyboardCover(barRef, coverRef);

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;
  const reading = state.status === "done" ? state.value.reading : null;
  useFigureJobs(books);
  // Keyed on the ids, so the frequent meta reloads during parsing do not restart the cover job.
  const bookIds = books.map((book) => book.id).join(" ");

  useEffect(() => {
    if (bookIds === "") return;
    const fiber = forkApp(ensureCovers(bookIds.split(" ")));
    return () => stopFiber(fiber);
  }, [bookIds]);

  // With a PDF on the shelf and no figure job running, the page renderer loads its scripts now,
  // after the launch work has settled, so the original view opens without that wait later.
  const hasPdf = books.some((book) => book.format !== "epub");
  const figuresBusy = books.some((book) => book.figuresPending);
  useEffect(() => {
    if (!hasPdf || figuresBusy) return;
    const timer = window.setTimeout(() => {
      void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [hasPdf, figuresBusy]);

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

  const importFiles = (files: ReadonlyArray<File>): void => {
    if (files.length === 0) return;
    setBusy(true);
    setImporting(true);
    setMessage(null);
    // Runs on cancel too: a cancelled file is removed without a meta update.
    const settle = Effect.sync(() => {
      setBusy(false);
      setImporting(false);
      setProgress(null);
      importJob.current = null;
      reload();
    });
    importJob.current = forkApp(
      importBooks(files, setProgress, setMessage).pipe(Effect.ensuring(settle)),
    );
  };

  const cancelImport = (): void => {
    if (importJob.current !== null) stopFiber(importJob.current);
  };

  const remove = (id: string): void => {
    const program = removeBook(id).pipe(
      Effect.tap(() => Effect.sync(() => reload())),
      Effect.catchTag("StorageFailure", (error) =>
        Effect.sync(() => setMessage(describeError(error, "This book"))),
      ),
    );
    void runApp(program);
  };

  const reparse = (id: string): void => {
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

  const actionLabel = busy ? "Working…" : "Add book";
  const grid = settings.libraryView === "grid";
  const shelf = useMemo(
    () => buildShelf(books, reading ?? new Map(), query, filters, settings.librarySort),
    [books, reading, query, filters, settings.librarySort],
  );

  const clearFilters = (): void =>
    setFilters({ status: null, series: null, length: null, author: null });
  const clearAll = (): void => {
    setQuery("");
    clearFilters();
  };
  const toggleFilter = (group: FilterGroup, value: string): void =>
    setFilters((current) => ({ ...current, [group]: current[group] === value ? null : value }));
  const pickFiles = (): void => input.current?.click();

  const searchField = <SearchField value={query} onChange={setQuery} />;
  const filterChips = <FilterChips shelf={shelf} onToggle={toggleFilter} onClear={clearFilters} />;
  const sortMenu = (
    <SortMenu sort={settings.librarySort} onChange={(sort) => update({ librarySort: sort })} />
  );
  const viewToggle = (
    <ViewToggle view={settings.libraryView} onChange={(view) => update({ libraryView: view })} />
  );
  const settingsButton = (
    <button
      type="button"
      className="btn btn-square btn-ghost md:btn-sm"
      aria-label="Settings"
      title="Settings"
      onClick={() => setSettingsOpen(true)}
    >
      <CogIcon className="size-6 md:size-4" />
    </button>
  );
  const tiles = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-5";
  const rows = "grid grid-cols-1 gap-3 md:grid-cols-2";
  const listClass = grid ? tiles : rows;
  const Item = grid ? BookTile : BookCard;

  return (
    <main className="mx-auto flex min-h-[var(--app-height)] w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] pb-[calc(var(--safe-bottom)+12rem)] md:max-w-5xl md:pb-8">
      <header className="flex items-center justify-between gap-3 pt-2">
        <h1>
          <Logo className="h-7 w-auto md:h-8" />
        </h1>
        <div className="hidden items-center gap-2 md:flex">
          {searchField}
          {sortMenu}
          {viewToggle}
          {settingsButton}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={pickFiles}
            disabled={busy}
          >
            <PlusIcon className="size-4" />
            {actionLabel}
          </button>
        </div>
        <div className="md:hidden">{settingsButton}</div>
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

      <ul className={listClass}>
        {shelf.cards.map((card) => (
          <Item key={card.book.id} card={card} onRemove={remove} onReparse={reparse} />
        ))}
      </ul>

      {shelf.cards.length === 0 && books.length > 0 && <NoMatches onClear={clearAll} />}

      <StorageUsage estimate={estimate} />

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,application/epub+zip,.epub"
        multiple
        className="hidden"
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div
        ref={coverRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 z-30 hidden h-screen bg-base-100 md:hidden"
      />
      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-base-300 bg-base-100 px-4 pt-2 pb-[calc(var(--safe-bottom)+0.5rem)] focus-within:pb-2 md:hidden"
      >
        {searchField}
        {filterChips}
        <div className="flex items-center gap-3">
          {viewToggle}
          {sortMenu}
          <button
            type="button"
            className="btn relative btn-square"
            aria-label="All filters"
            title="All filters"
            onClick={() => setFiltersOpen(true)}
          >
            <FunnelIcon className="size-5" />
            {shelf.filtered && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
            )}
          </button>
          <button
            type="button"
            className="btn flex-1 btn-primary"
            onClick={pickFiles}
            disabled={busy}
          >
            {actionLabel}
          </button>
        </div>
      </div>

      <FilterSheet
        open={filtersOpen}
        shelf={shelf}
        onToggle={toggleFilter}
        onClear={clearFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {busy && (
        <ProgressPanel progress={progress} onCancel={importing ? cancelImport : undefined} />
      )}
    </main>
  );
}
