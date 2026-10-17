import { useVirtualizer } from "@tanstack/react-virtual";
import { Effect, Stream } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router";
import { CogIcon, FunnelIcon, PlusIcon } from "@/components/icons";
import { fontFamily, TOUR_VERSION } from "@/domain/book";
import {
  forkApp,
  runApp,
  stopFiber,
  useAiSettings,
  useAppEffect,
  useFigureJobs,
  useSettings,
} from "@/lib/hooks";
import { onLaunchFiles } from "@/lib/launch-files";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { slideTo } from "@/lib/slide-to";
import { tourSteps } from "@/lib/tour";
import {
  buildShelf,
  shelfRecords,
  type FilterGroup,
  type Filters,
  type LibraryCard,
  emptyFilters,
  type Shelf,
} from "@/lib/shelf";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { ensureCovers, resetBookCover, setBookCover } from "@/use-cases/book-image";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { setBookFinished } from "@/use-cases/save-progress";
import { hideSeries, saveSeries, setBookSeries } from "@/use-cases/series";
import { describeError } from "@/lib/describe-error";
import { BookSheet } from "./_BookSheet";
import { FilterChips } from "./_FilterChips";
import { FilterSheet } from "./_FilterSheet";
import { ProgressPanel } from "./_ProgressPanel";
import { InstallHint } from "./_InstallHint";
import { LibraryRows } from "./_LibraryRows";
import {
  actionLabelFor,
  booksToShow,
  columnsFor,
  hiddenClass,
  loadedLibrary,
  showsTour,
} from "./_library-derived";
import { useLibraryActions } from "./_use-library-actions";
import { useSeriesGrouping } from "./_use-series-grouping";
import { useHideOnScroll, useKeyboardFit, useSearchPanelHeight } from "./_use-library-viewport";
import { LibraryStatus } from "./_LibraryStatus";
import { NoMatches } from "./_NoMatches";
import { Logo } from "./_Logo";
import { SearchField } from "./_SearchField";
import { SeriesSheet } from "./_SeriesSheet";
import { LicencesSheet } from "./_LicencesSheet";
import { SettingsSheet } from "./_SettingsSheet";
import { SortMenu } from "./_SortMenu";
import { StorageUsage } from "./_StorageUsage";
import { Tour } from "./_Tour";
import { ViewToggle } from "./_ViewToggle";

const showInstallHint = isIosBrowser && !isInstalled;

// `hidden` while a book is open over it, which keeps its state and pauses its background jobs.
export function LibraryRoute({ isHidden }: { isHidden: boolean }): ReactElement {
  const { state, reload } = useAppEffect(
    Effect.gen(function* () {
      const store = yield* BookStore;
      const books = yield* store.list();
      const estimate = yield* store.estimate();
      const series = yield* store.listSeries();
      const reading = yield* Effect.forEach(
        books,
        (book) =>
          Effect.gen(function* () {
            const progress = yield* store.getProgress(book.id);
            const prefs = yield* store
              .getPrefs(book.id)
              .pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null)));

            shelfRecords.set(book.id, { meta: book, progress, prefs });

            return [book.id, progress] as const;
          }),
        { concurrency: "unbounded" },
      );

      return { books, estimate, reading: new Map(reading), series };
    }),
    [],
  );

  const { settings, update } = useSettings();
  const { ai } = useAiSettings();
  const {
    isBusy,
    isImporting,
    progress,
    message,
    setMessage,
    importFiles,
    cancelImport,
    remove,
    reparse,
  } = useLibraryActions(reload);
  const [query, setQuery] = useState("");
  const [mobileSearchAndFiltersVisible, setMobileSearchAndFiltersVisible] = useState(true);
  const searchPanel = useRef<HTMLDivElement>(null);
  const searchPanelHeight = useSearchPanelHeight(searchPanel);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [licencesOpen, setLicencesOpen] = useState(false);
  const [bookActions, setBookActions] = useState<LibraryCard | null>(null);
  // A null id is a new series from the Book sheet.
  const [seriesEdit, setSeriesEdit] = useState<{
    id: string | null;
    name: string;
    books: ReadonlyArray<LibraryCard>;
  } | null>(null);
  // Several can be open, so opening one never moves the books of another.
  const [openSeries, setOpenSeries] = useState<ReadonlySet<string>>(() => new Set());
  // The series the last tap opened, which alone fades in.
  const justOpened = useRef<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    status: null,
    length: null,
    author: null,
  });
  const input = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useHideOnScroll(scrollRef, setMobileSearchAndFiltersVisible);

  useKeyboardFit(rootRef);

  const { books, estimate, reading, series } = loadedLibrary(state);
  const steps = tourSteps({ hasBooks: books.length > 0, needsInstall: showInstallHint });
  const isTouring = showsTour({
    isHidden,
    status: state.status,
    tour: settings.tour,
    steps,
  });

  useFigureJobs(booksToShow(isHidden, books));

  const {
    grouping,
    retry: retryGrouping,
    reset: resetGrouping,
  } = useSeriesGrouping({
    isHidden,
    isBusy,
    books,
    ai,
  });

  // Back from a book, the shelf reads again, so its statuses show the reading just done.
  const wasHidden = useRef(isHidden);

  useEffect(() => {
    if (wasHidden.current && !isHidden) reload();
    wasHidden.current = isHidden;
  }, [isHidden, reload]);

  // Keyed on the ids, so the frequent meta reloads during parsing do not restart the cover job.
  const bookIds = books.map((book) => book.id).join(" ");

  useEffect(() => {
    if (isHidden || bookIds === "") return;

    const fiber = forkApp(ensureCovers(bookIds.split(" ")));

    return () => stopFiber(fiber);
  }, [isHidden, bookIds]);

  // A book's text waits for its font, so the reading fonts load with the library.
  useEffect(() => {
    for (const family of Object.values(fontFamily)) void document.fonts.load(`1em "${family}"`);
  }, []);

  // The page renderer loads its scripts after launch settles, so the original view has no wait.
  const hasPdf = books.some((book) => book.format !== "epub");
  const figuresBusy = books.some((book) => book.figuresPending);

  useEffect(() => {
    if (isHidden || !hasPdf || figuresBusy) return;

    const timer = window.setTimeout(() => {
      void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [isHidden, hasPdf, figuresBusy]);

  useEffect(() => {
    const program = importInboxOnce().pipe(
      Effect.tap(({ imported, failure }) =>
        Effect.sync(() => {
          if (imported > 0) reload();
          if (failure !== null) setMessage(failure);
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
          // A save as the book closes can land after the reread above. While hidden, it waits for it.
          Stream.filter(
            (update) =>
              update.kind === "meta" ||
              update.kind === "series" ||
              (update.kind === "progress" && !isHidden),
          ),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );

    return () => stopFiber(fiber);
  }, [isHidden, reload]);

  const actionLabel = actionLabelFor(isBusy);
  const isGrid = settings.libraryView === "grid";
  const shelf = useMemo(
    () => buildShelf(books, reading ?? new Map(), query, filters, settings.librarySort, series),
    [books, reading, query, filters, settings.librarySort, series],
  );
  const { items, trays } = useMemo(() => {
    const items: Array<
      Shelf["items"][number] | { readonly kind: "member"; readonly card: LibraryCard }
    > = [];
    const trays: Array<{ start: number; end: number; hue: number }> = [];

    for (const item of shelf.items) {
      items.push(item);
      if (item.kind !== "series" || !openSeries.has(item.id)) continue;

      trays.push({
        start: items.length - 1,
        end: items.length - 1 + item.books.length,
        hue: item.color,
      });
      for (const card of item.books) items.push({ kind: "member", card });
    }

    return { items, trays };
  }, [shelf, openSeries]);
  const cards = useMemo(
    () => items.flatMap((item) => (item.kind === "series" ? [] : [item.card])),
    [items],
  );

  // The grid's breakpoints: 2 columns, 3 from sm, 5 from md. A list has 1, or 2 from md.
  const [wide, setWide] = useState(() => ({
    isSm: window.matchMedia("(width >= 40rem)").matches,
    isMd: window.matchMedia("(width >= 48rem)").matches,
  }));

  useEffect(() => {
    const sm = window.matchMedia("(width >= 40rem)");
    const md = window.matchMedia("(width >= 48rem)");
    const follow = (): void => setWide({ isSm: sm.matches, isMd: md.matches });

    sm.addEventListener("change", follow);
    md.addEventListener("change", follow);

    return () => {
      sm.removeEventListener("change", follow);
      md.removeEventListener("change", follow);
    };
  }, []);

  const columns = columnsFor(isGrid, wide);
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
        items.slice(row * columns, (row + 1) * columns),
      ),
    [items, columns],
  );

  // Only a just-opened series fades in. The rest move at once, so the scroll holds.
  useLayoutEffect(() => {
    const list = listRef.current;
    const opened = justOpened.current;

    justOpened.current = null;
    if (opened === null || list === null) return;

    const root = [...list.querySelectorAll<HTMLElement>("[data-series-root]")].find(
      (element) => element.dataset.seriesRoot === opened,
    );
    const members = [...list.querySelectorAll<HTMLElement>("[data-series-member]")].filter(
      (element) => element.dataset.seriesMember === opened,
    );

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tray = root?.querySelector<HTMLElement>("[data-tray]");

    for (const element of tray === null || tray === undefined ? members : [tray, ...members]) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    }
  }, [openSeries]);

  // The header and notices scroll above the rows, so the rows start this far into the scroll box.
  const [listTop, setListTop] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const box = scrollRef.current;

    if (list === null || box === null) return;

    const top = list.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

    if (top !== listTop) setListTop(top);
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // A first guess only, as each row is measured once it renders.
    estimateSize: () => (isGrid ? 320 : 132),
    overscan: 3,
    scrollMargin: listTop,
  });

  // A row of another view or width has another height, so the measured heights do not match.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, isGrid, columns]);

  // A new search or filter shows its results from the top.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, filters]);

  // Back from a book the shelf stays, unless the sort moved the book out of view. Then it shows it.
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // A file the app was opened with imports like a choice from the picker, then opens. One it holds opens at once.
  const [launched, setLaunched] = useState<string | null>(null);
  const launch = useRef({ importFiles, isHidden });

  useEffect(() => {
    launch.current = { importFiles, isHidden };
  });
  useEffect(() => {
    onLaunchFiles((files) => {
      if (files.length === 0) return;
      // Back to the shelf by a history step, so the import shows and the new book is one step from it.
      if (launch.current.isHidden) slideTo(navigate, "/", "out");
      launch.current.importFiles(files, (ids) => setLaunched(ids[0] ?? null));
    });
  }, [navigate]);
  // Opened once the shelf shows, so the step back to it cannot land after the book and undo it.
  useEffect(() => {
    if (launched === null || isHidden) return;

    setLaunched(null);
    slideTo(navigate, `/book/${launched}`, "in");
  }, [launched, isHidden, navigate]);

  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (isHidden) opened.current = pathname;
  }, [isHidden, pathname]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const index = cards.findIndex((card) => `/book/${card.book.id}` === opened.current);

    if (isHidden || box === null || index === -1) return;

    const card = box.querySelector(`a[href="${opened.current}"]`)?.getBoundingClientRect();
    const view = box.getBoundingClientRect();

    if (card !== undefined && card.bottom > view.top && card.top < view.bottom) return;

    // The first row goes up with the header above it.
    if (index < columns) box.scrollTo({ top: 0 });
    else virtualizer.scrollToIndex(Math.floor(index / columns), { align: "start" });
  }, [isHidden, cards, columns, virtualizer]);
  // Until the reader moves the shelf themselves.
  useEffect(() => {
    if (isHidden) return;

    const release = (): void => {
      opened.current = null;
    };

    for (const type of ["pointerdown", "wheel", "keydown"]) window.addEventListener(type, release);

    return () => {
      for (const type of ["pointerdown", "wheel", "keydown"])
        window.removeEventListener(type, release);
    };
  }, [isHidden]);

  const clearFilters = (): void => setFilters(emptyFilters);
  const clearAll = (): void => {
    setQuery("");
    clearFilters();
  };
  const toggleFilter = (group: FilterGroup, value: string): void =>
    setFilters((current) => ({ ...current, [group]: current[group] === value ? null : value }));
  const pickFiles = (): void => input.current?.click();
  const toggleSeries = (id: string): void => {
    const next = new Set(openSeries);

    if (next.delete(id)) justOpened.current = null;
    else {
      next.add(id);
      justOpened.current = id;
    }

    setOpenSeries(next);
  };

  const searchField = <SearchField value={query} onChange={setQuery} />;
  const filterChips = <FilterChips shelf={shelf} onToggle={toggleFilter} onClear={clearFilters} />;
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

  return (
    // A fixed column with its own scroll box, so the window never scrolls. Hidden, it keeps its layout.
    <main
      ref={rootRef}
      // When the keyboard closes, the column grows back at about the keyboard's pace.
      className={`fixed inset-x-0 top-0 flex h-(--app-height) flex-col bg-base-100 motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out ${hiddenClass(isHidden)}`}
      inert={isHidden}
      aria-hidden={isHidden}
    >
      <div
        ref={scrollRef}
        data-library-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div
          // It is 1px taller: iOS bounces the bars on a swipe over a box with nothing to scroll.
          className="mx-auto flex min-h-[calc(100%+1px)] w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] md:max-w-5xl"
          // Room under the last row for the search panel that floats over it on a phone.
          style={{ paddingBottom: `calc(2rem + ${searchPanelHeight}px)` }}
        >
          <header className="flex items-center justify-between gap-3 pt-2">
            <h1>
              <Logo className="h-7 w-auto md:h-8" />
            </h1>
            <div className="hidden items-center gap-2 md:flex">
              {searchField}
              <SortMenu
                sort={settings.librarySort}
                onChange={(sort) => update({ librarySort: sort })}
              />
              {viewToggle}
              {settingsButton}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={pickFiles}
                disabled={isBusy}
                data-tour="import"
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
            isLoading={state.status === "loading"}
            hasFailed={state.status === "error"}
            books={books}
          />

          <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            <LibraryRows
              virtualizer={virtualizer}
              rows={rows}
              columns={columns}
              isGrid={isGrid}
              listTop={listTop}
              trays={trays}
              openSeries={openSeries}
              onToggleSeries={toggleSeries}
              onSeriesActions={setSeriesEdit}
              onBookActions={setBookActions}
            />
          </div>

          {items.length === 0 && books.length > 0 && <NoMatches onClear={clearAll} />}

          <StorageUsage estimate={estimate} />
        </div>
      </div>

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

      {/* The panel floats, so the list keeps its size: an iOS scroll box that resizes stutters. */}
      <div className="group relative z-20 shrink-0 md:hidden">
        <div
          ref={searchPanel}
          className={`absolute inset-x-0 bottom-full border-t border-base-300 bg-base-100 px-4 pt-2 transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none ${
            mobileSearchAndFiltersVisible ? "" : "translate-y-full opacity-0"
          }`}
          aria-hidden={!mobileSearchAndFiltersVisible}
          inert={!mobileSearchAndFiltersVisible}
        >
          <div className="flex flex-col gap-2 pb-2">
            {searchField}
            {filterChips}
          </div>
        </div>
        <div
          className={`relative flex items-center gap-2 border-t bg-base-100 px-4 pt-2 pb-[calc(var(--safe-bottom)+0.5rem)] transition-colors duration-200 group-has-[input:focus]:pb-2 ${
            mobileSearchAndFiltersVisible ? "border-transparent" : "border-base-300"
          }`}
        >
          {viewToggle}
          <button
            type="button"
            className="btn relative btn-square"
            aria-label="Sort and filter"
            title="Sort and filter"
            onClick={() => setFiltersOpen(true)}
          >
            <FunnelIcon className="size-6" />
            {shelf.isFiltered && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
            )}
          </button>
          <button
            type="button"
            className="btn flex-1 btn-primary"
            onClick={pickFiles}
            disabled={isBusy}
            data-tour="import"
          >
            {actionLabel}
          </button>
        </div>
      </div>

      <FilterSheet
        isOpen={filtersOpen}
        shelf={shelf}
        sort={settings.librarySort}
        onSort={(sort) => update({ librarySort: sort })}
        onToggle={toggleFilter}
        onClear={clearFilters}
        onClose={() => setFiltersOpen(false)}
      />

      {isTouring && <Tour steps={steps} onDone={() => update({ tour: TOUR_VERSION })} />}

      <SettingsSheet
        isOpen={settingsOpen}
        grouping={grouping}
        onRetry={retryGrouping}
        onReset={resetGrouping}
        onClose={() => setSettingsOpen(false)}
        onLicences={() => {
          setSettingsOpen(false);
          setLicencesOpen(true);
        }}
      />

      {licencesOpen && <LicencesSheet onClose={() => setLicencesOpen(false)} />}

      {bookActions !== null && (
        <BookSheet
          card={bookActions}
          progress={reading?.get(bookActions.book.id) ?? null}
          groups={shelf.series}
          onFinished={(id, finished, place) => {
            setMessage(null);
            void runApp(
              setBookFinished(id, finished, place).pipe(
                Effect.catchTag("StorageFailure", (error) =>
                  Effect.sync(() => setMessage(describeError(error, "This book"))),
                ),
              ),
            );
          }}
          onSeries={(id, seriesId) => {
            setMessage(null);
            void runApp(
              setBookSeries(id, seriesId).pipe(
                Effect.catchTag("StorageFailure", (error) =>
                  Effect.sync(() => setMessage(describeError(error, "This series"))),
                ),
              ),
            );
          }}
          onEditSeries={setSeriesEdit}
          onRemove={remove}
          onReparse={reparse}
          onCover={(id, picture) => {
            setMessage(null);
            void runApp(
              setBookCover(id, picture).pipe(
                Effect.flatMap((saved) =>
                  Effect.sync(() => {
                    if (!saved)
                      setMessage(`${picture.name} is not a picture Reader Hero can read.`);
                  }),
                ),
                Effect.catchTags({
                  BookNotFound: (error) =>
                    Effect.sync(() => setMessage(describeError(error, "This book"))),
                  StorageFailure: (error) =>
                    Effect.sync(() => setMessage(describeError(error, "This cover"))),
                }),
              ),
            );
          }}
          onResetCover={(id) => {
            setMessage(null);
            void runApp(
              resetBookCover(id).pipe(
                Effect.catchTags({
                  BookNotFound: (error) =>
                    Effect.sync(() => setMessage(describeError(error, "This book"))),
                  StorageFailure: (error) =>
                    Effect.sync(() => setMessage(describeError(error, "This cover"))),
                }),
              ),
            );
          }}
          onClose={() => setBookActions(null)}
        />
      )}

      {seriesEdit !== null && (
        <SeriesSheet
          series={seriesEdit}
          stored={series.find((record) => record.id === seriesEdit.id)}
          cards={shelf.cards}
          groups={shelf.series}
          onSave={(edit) => {
            setMessage(null);
            void runApp(
              saveSeries(edit).pipe(
                Effect.catchTag("StorageFailure", (error) =>
                  Effect.sync(() => setMessage(describeError(error, "This series"))),
                ),
              ),
            );
          }}
          onRemove={(id, name) => {
            setMessage(null);
            void runApp(
              hideSeries(id, name).pipe(
                Effect.catchTag("StorageFailure", (error) =>
                  Effect.sync(() => setMessage(describeError(error, "This series"))),
                ),
              ),
            );
          }}
          onClose={() => setSeriesEdit(null)}
        />
      )}

      {isBusy && (
        <ProgressPanel progress={progress} onCancel={isImporting ? cancelImport : undefined} />
      )}
    </main>
  );
}
