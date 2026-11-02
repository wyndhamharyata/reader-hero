import { useVirtualizer } from "@tanstack/react-virtual";
import { Effect, Stream } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { CogIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from "@/components/icons";
import { fontFamily, type LibrarySort, type ParseState } from "@/domain/book";
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
import { openBook, prefersLessMotion } from "@/lib/open-book";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import {
  buildShelf,
  emptyFilters,
  shelfRecords,
  bookDetails,
  type Filters,
  type LibraryCard,
  type Shelf,
} from "@/lib/shelf";
import { slideTo } from "@/lib/slide-to";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { ensureCovers } from "@/use-cases/book-image";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { BookSheet } from "./_BookSheet";
import { isBuilding } from "./_BookTile";
import { ContinueCard } from "./_ContinueCard";
import { EmptyShelf } from "./_EmptyShelf";
import { booksToShow, hiddenClass, loadedLibrary } from "./_library-derived";
import { LibraryRows, rowKey, shelfRows, type ShelfRow, type TileEvents } from "./_LibraryRows";
import { LicencesSheet } from "./_LicencesSheet";
import { Logo } from "./_Logo";
import { NoMatches } from "./_NoMatches";
import { ProgressPanel } from "./_ProgressPanel";
import { SearchField } from "./_SearchField";
import { SeriesSheet } from "./_SeriesSheet";
import { SettingsSheet } from "./_SettingsSheet";
import { SortMenu } from "./_SortMenu";
import { useLibraryActions } from "./_use-library-actions";
import { useSeriesGrouping } from "./_use-series-grouping";

const showInstallHint = isIosBrowser && !isInstalled;
const installHintKey = "install-hint-dismissed";

// Without storage the hint shows each time, which costs only a tap.
function isInstallHintDismissed(): boolean {
  try {
    return localStorage.getItem(installHintKey) !== null;
  } catch {
    return false;
  }
}
const dealMs = 1200;
const freshMs = 1000;
const fallMs = 620;
const closeUpMs = 380;
const phoneColumns = 2;
const tileGapPx = 26;

const statusFilters: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: "All" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
];

// A small phone shows two covers a row, a large one three. Wider, as many as fit at the tile's least width.
function columnsFor(widthPx: number): number {
  if (!window.matchMedia("(width >= 48rem)").matches) {
    return window.matchMedia("(width >= 30rem)").matches ? 3 : phoneColumns;
  }

  const tilePx = window.matchMedia("(width >= 70rem)").matches ? 160 : 150;

  return Math.max(3, Math.floor((widthPx + tileGapPx) / (tilePx + tileGapPx)));
}

function tilePlaces(box: HTMLElement | null): Map<string, DOMRect> {
  const places = new Map<string, DOMRect>();

  for (const element of box?.querySelectorAll<HTMLElement>("[data-book-id], [data-series-root]") ??
    []) {
    places.set(
      element.dataset.bookId ?? element.dataset.seriesRoot ?? "",
      element.getBoundingClientRect(),
    );
  }

  return places;
}

function rowOf(rows: ReadonlyArray<ShelfRow>, bookId: string): number {
  return rows.findIndex((row) =>
    row.kind === "tray"
      ? row.series.books.some((card) => card.book.id === bookId)
      : row.items.some((item) => item.kind === "book" && item.card.book.id === bookId),
  );
}

// The books being read, the latest first. The card up front shows the first, a wide screen two.
function continuingCards(
  shelf: Shelf,
  reading: ReadonlyMap<string, { readonly updatedAt: number } | null>,
): ReadonlyArray<LibraryCard> {
  const updatedAt = (card: LibraryCard): number => reading.get(card.book.id)?.updatedAt ?? 0;

  return [...shelf.cards.values()]
    .filter((card) => card.status === "reading")
    .sort((a, b) => updatedAt(b) - updatedAt(a))
    .slice(0, 2);
}

function LibraryHeader({
  query,
  isBusy,
  isSearchOpen,
  onQuery,
  onSearchOpen,
  onSettings,
  onAdd,
}: {
  readonly query: string;
  readonly isBusy: boolean;
  readonly isSearchOpen: boolean;
  readonly onQuery: (query: string) => void;
  readonly onSearchOpen: (isOpen: boolean) => void;
  readonly onSettings: () => void;
  readonly onAdd: () => void;
}): ReactElement {
  return (
    <>
      <header className="flex items-center gap-2.5 px-4 pt-4.5 pb-2.5 md:px-8 md:pt-6 md:pb-3.5">
        <h1 className="mr-auto">
          <Logo className="h-10 w-auto" />
        </h1>
        <div className="hidden md:block">
          <SearchField value={query} onChange={onQuery} />
        </div>
        <button
          type="button"
          className="key square md:hidden"
          aria-label={isSearchOpen ? "Close search" : "Search books"}
          aria-pressed={isSearchOpen}
          onClick={() => {
            if (isSearchOpen) onQuery("");
            onSearchOpen(!isSearchOpen);
          }}
        >
          {isSearchOpen ? <XMarkIcon className="icon" /> : <MagnifyingGlassIcon className="icon" />}
        </button>
        <button type="button" className="key square" aria-label="Settings" onClick={onSettings}>
          <CogIcon className="icon" />
        </button>
        <button
          type="button"
          className="key green hidden md:inline-flex"
          disabled={isBusy}
          onClick={onAdd}
        >
          <PlusIcon className="icon" />
          Add book
        </button>
      </header>

      {isSearchOpen && (
        <div className="rise px-4 pb-3 md:hidden">
          <SearchField value={query} isFocused onChange={onQuery} />
        </div>
      )}
    </>
  );
}

// All, Reading and Finished, with their counts, then the sort.
function ShelfControls({
  shelf,
  status,
  sort,
  onStatus,
  onSort,
}: {
  readonly shelf: Shelf;
  readonly status: string | null;
  readonly sort: LibrarySort;
  readonly onStatus: (status: string | null) => void;
  readonly onSort: (sort: LibrarySort) => void;
}): ReactElement {
  const cards = [...shelf.cards.values()];
  const countOf = (value: string | null): number =>
    value === null ? cards.length : cards.filter((card) => card.status === value).length;

  return (
    <div className="flex items-center gap-2.5 px-4 pb-8 md:px-8 md:pb-9">
      <div className="latch-row flex-1 md:flex-none" role="group" aria-label="Show">
        {statusFilters.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className="key flex-1 px-2.5 md:flex-none md:px-3.5"
            aria-pressed={status === entry.value}
            onClick={() => onStatus(entry.value)}
          >
            {entry.label}
            <span className="count">{countOf(entry.value)}</span>
          </button>
        ))}
      </div>
      <SortMenu sort={sort} onChange={onSort} />
    </div>
  );
}

function LibraryNotices({
  message,
  hasFailed,
}: {
  readonly message: string | null;
  readonly hasFailed: boolean;
}): ReactElement {
  return (
    <>
      {message !== null && (
        <p className="notice warn mx-4 mb-4 whitespace-pre-line md:mx-8">{message}</p>
      )}
      {hasFailed && (
        <p className="notice error mx-4 mb-4 md:mx-8">Your library could not be loaded.</p>
      )}
    </>
  );
}

// The books being read up front, the import while it runs, then the filters and the sort.
function ShelfTop({
  isLoaded,
  continuing,
  adding,
  shelf,
  status,
  sort,
  onOpen,
  onStatus,
  onSort,
}: {
  readonly isLoaded: boolean;
  readonly continuing: ReadonlyArray<LibraryCard>;
  readonly adding: ReactElement | null;
  readonly shelf: Shelf;
  readonly status: string | null;
  readonly sort: LibrarySort;
  readonly onOpen: (card: LibraryCard, cover: Element | null) => void;
  readonly onStatus: (status: string | null) => void;
  readonly onSort: (sort: LibrarySort) => void;
}): ReactElement {
  return (
    <>
      {continuing.length > 0 && (
        <div className="flex gap-4 px-4 pt-1.5 pb-4.5 md:px-8 md:pb-6">
          {continuing.map((card, index) => (
            <div
              key={card.book.id}
              // A second card shows only where there is room for two side by side.
              className={
                index === 0 ? "flex min-w-0 flex-1" : "hidden min-w-0 flex-1 min-[70rem]:flex"
              }
            >
              <ContinueCard
                card={card}
                isGreen={index === 0}
                onOpen={(cover) => onOpen(card, cover)}
              />
            </div>
          ))}
        </div>
      )}
      {adding}
      {isLoaded && (
        <ShelfControls
          shelf={shelf}
          status={status}
          sort={sort}
          onStatus={onStatus}
          onSort={onSort}
        />
      )}
    </>
  );
}

function ShelfFooter({
  hasNoMatches,
  query,
  status,
  showsInstall,
  onClear,
  onDismissInstall,
}: {
  readonly hasNoMatches: boolean;
  readonly query: string;
  readonly status: string | null;
  readonly showsInstall: boolean;
  readonly onClear: () => void;
  readonly onDismissInstall: () => void;
}): ReactElement {
  return (
    <>
      {hasNoMatches && <NoMatches query={query} status={status} onClear={onClear} />}
      {showsInstall && (
        <div className="mx-4 mb-4.5 flex items-center gap-3 rounded-[14px] border border-dashed border-(--line) py-2 pr-2 pl-4 text-[13.5px] text-(--ink-soft) md:mx-8">
          <p className="flex-1">
            Add Reader Hero to your Home Screen so iOS keeps your library offline.
          </p>
          <button
            type="button"
            className="key small square"
            aria-label="Dismiss"
            onClick={onDismissInstall}
          >
            <XMarkIcon className="icon size-4" />
          </button>
        </div>
      )}
    </>
  );
}

// The phone's Add book floats in reach of a thumb. Files dragged over a full shelf show where they go.
function AddControls({
  hasShelf,
  isDropping,
  isBusy,
  onAdd,
}: {
  readonly hasShelf: boolean;
  readonly isDropping: boolean;
  readonly isBusy: boolean;
  readonly onAdd: () => void;
}): ReactElement | null {
  if (!hasShelf) return null;

  return (
    <>
      <button
        type="button"
        className="key green fixed right-4 bottom-[calc(var(--safe-bottom)+1.6rem)] z-10 min-h-13 rounded-2xl px-5 text-base md:hidden"
        disabled={isBusy}
        onClick={onAdd}
      >
        <PlusIcon className="icon" />
        Add book
      </button>
      {isDropping && (
        <div className="dropzone">
          <div className="flex flex-col items-center">
            <span className="key green mb-3.5 size-18 rounded-[20px]">
              <PlusIcon className="size-7.5" />
            </span>
            Drop to add
          </div>
        </div>
      )}
    </>
  );
}

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
    setFinished,
    setSeries,
    setCover,
    resetCover,
    editSeries,
    removeSeries,
  } = useLibraryActions(reload);
  const [query, setQuery] = useState("");
  const [isSearchOpen, setSearchOpen] = useState(false);
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
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [isDropping, setDropping] = useState(false);
  const [isDealing, setDealing] = useState(true);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [isInstallHintShown, setInstallHintShown] = useState(
    () => showInstallHint && !isInstallHintDismissed(),
  );
  const input = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<Map<string, DOMRect> | null>(null);
  const parseStates = useRef(new Map<string, ParseState>());

  const { books, estimate, reading, series } = loadedLibrary(state);

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
          // A save as the book closes can arrive after the reread above. While hidden, it waits for it.
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

  // The covers deal in once, the first time the shelf shows.
  const isLoaded = state.status === "done";

  useEffect(() => {
    if (!isLoaded) return;

    const timer = window.setTimeout(() => setDealing(false), dealMs);

    return () => window.clearTimeout(timer);
  }, [isLoaded]);

  // A book that finishes building drops its cover onto the shelf.
  useEffect(() => {
    const arrived = books.filter((book) => {
      const before = parseStates.current.get(book.id);
      const wasBuilding = before === "pending" || before === "parsing";

      return wasBuilding && book.parseState !== "pending" && book.parseState !== "parsing";
    });

    parseStates.current = new Map(books.map((book) => [book.id, book.parseState]));
    if (arrived.length > 0) setFresh(new Set(arrived.map((book) => book.id)));
  }, [books]);
  useEffect(() => {
    if (fresh.size === 0) return;

    const timer = window.setTimeout(() => setFresh(new Set()), freshMs);

    return () => window.clearTimeout(timer);
  }, [fresh]);

  const shelf = useMemo(
    () =>
      buildShelf(
        books,
        reading ?? new Map(),
        query,
        filters,
        settings.librarySort,
        series,
        settings.seriesGrouping,
      ),
    [books, reading, query, filters, settings.librarySort, series, settings.seriesGrouping],
  );

  // The list's width sets the columns, so a tile keeps its size as the window grows.
  const [columns, setColumns] = useState(phoneColumns);

  useLayoutEffect(() => {
    const list = listRef.current;

    if (list === null) return;

    const observer = new ResizeObserver(() => setColumns(columnsFor(list.clientWidth)));

    observer.observe(list);

    return () => observer.disconnect();
  }, [isLoaded]);

  const rows = useMemo(
    () => shelfRows(shelf.items, columns, openSeries),
    [shelf.items, columns, openSeries],
  );

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
    estimateSize: () => 260,
    getItemKey: (index) => rowKey(rows[index], index),
    overscan: 3,
    scrollMargin: listTop,
  });

  // A row of another width has another height, so the measured heights do not match.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns]);

  // A new search or filter shows its results from the top.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, filters]);

  // A deleted book's neighbours slide into its place.
  useLayoutEffect(() => {
    const before = flipFrom.current;

    flipFrom.current = null;
    if (before === null || prefersLessMotion()) return;

    for (const [id, now] of tilePlaces(scrollRef.current)) {
      const was = before.get(id);
      const dx = (was?.left ?? now.left) - now.left;
      const dy = (was?.top ?? now.top) - now.top;
      const element = scrollRef.current?.querySelector(
        `[data-book-id="${id}"], [data-series-root="${id}"]`,
      );

      if (element === null || element === undefined || (dx === 0 && dy === 0)) continue;

      // Slid along the shelf: a hard book runs a few pixels past and stops dead.
      const past = `translate(${-Math.sign(dx) * 3}px, ${-Math.sign(dy) * 3}px)`;

      element.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
          { transform: past, offset: 0.8, easing: "ease-out" },
          { transform: "none" },
        ],
        { duration: closeUpMs },
      );
    }
  }, [rows]);

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
  // Opened once the shelf shows, so the step back to it cannot arrive after the book and undo it.
  useEffect(() => {
    if (launched === null || isHidden) return;

    setLaunched(null);
    slideTo(navigate, `/book/${launched}`, "in");
  }, [launched, isHidden, navigate]);

  // Files dragged over the window go to the import, as a choice from the picker does.
  useEffect(() => {
    if (isHidden) return;

    let depth = 0;
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;

      depth += 1;
      setDropping(true);
    };
    const onOver = (event: DragEvent): void => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;

      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;

      event.preventDefault();
      depth = 0;
      setDropping(false);
      launch.current.importFiles(Array.from(event.dataTransfer?.files ?? []));
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [isHidden]);

  // The reader's Book details opens the sheet here, over the reader, so the reader stays open.
  const cards = useRef(shelf.cards);

  useEffect(() => {
    cards.current = shelf.cards;
  });
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const card = cards.current.get((event as CustomEvent<string>).detail);

      if (card !== undefined) setBookActions(card);
    };

    bookDetails.addEventListener("open", onOpen);

    return () => bookDetails.removeEventListener("open", onOpen);
  }, []);

  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (isHidden) opened.current = pathname.slice("/book/".length);
  }, [isHidden, pathname]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const bookId = opened.current;
    const index = bookId === null ? -1 : rowOf(rows, bookId);

    if (isHidden || box === null || index === -1) return;

    const tile = box.querySelector(`[data-book-id="${bookId}"]`)?.getBoundingClientRect();
    const view = box.getBoundingClientRect();

    if (tile !== undefined && tile.bottom > view.top && tile.top < view.bottom) return;

    // The first row goes up with the header above it.
    if (index === 0) box.scrollTo({ top: 0 });
    else virtualizer.scrollToIndex(index, { align: "start" });
  }, [isHidden, rows, virtualizer]);
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

  const pickFiles = (): void => input.current?.click();
  const toggleSeries = (id: string): void => {
    const next = new Set(openSeries);

    if (!next.delete(id)) next.add(id);
    setOpenSeries(next);
  };
  const open = (card: LibraryCard, cover: Element | null): void => {
    const isFirstOpen = (reading.get(card.book.id) ?? null) === null;

    openBook(navigate, card.book.id, cover, isFirstOpen);
  };
  const openFromShelf = (card: LibraryCard): void =>
    open(card, scrollRef.current?.querySelector(`[data-book-id="${card.book.id}"] .cover`) ?? null);
  const removeWithFall = (id: string): void => {
    const tile = scrollRef.current?.querySelector(`[data-book-id="${id}"]`);
    const finish = (): void => {
      flipFrom.current = tilePlaces(scrollRef.current);
      remove(id);
    };

    if (tile === null || tile === undefined || prefersLessMotion()) {
      finish();
      return;
    }

    // Lifted, tipped off its foot, and dropped. It fades only once clear of the shelf.
    const fall = [
      { transform: "none", easing: "ease-out" },
      { transform: "translateY(-12px) rotate(-4deg)", offset: 0.2, easing: "ease-in-out" },
      {
        transform: "translateY(-8px) rotate(12deg)",
        offset: 0.38,
        easing: "cubic-bezier(0.55, 0, 1, 0.45)",
      },
      { transform: "translate(30px, 160px) rotate(52deg)", opacity: 1, offset: 0.82 },
      { transform: "translate(40px, 220px) rotate(64deg)", opacity: 0 },
    ];

    Object.assign((tile as HTMLElement).style, {
      position: "relative",
      zIndex: "5",
      transformOrigin: "100% 100%",
    });
    void tile.animate(fall, { duration: fallMs, fill: "forwards" }).finished.then(finish);
  };
  const isEmpty = isLoaded && books.length === 0;
  // Under every filter too, so the tabs below it never move under a finger.
  const isShelfPlain = query.trim() === "";
  const events: TileEvents = {
    onOpen: open,
    onBookActions: setBookActions,
    onToggleSeries: toggleSeries,
    onSeriesActions: setSeriesEdit,
    fillOf: (card) => {
      const file = progress?.file;
      const isThisFile = file === undefined || file.name === card.book.fileName;

      if (progress === null || !isBuilding(card) || !isThisFile) return 0;

      return progress.page / Math.max(1, progress.total);
    },
    isFresh: (id) => fresh.has(id),
  };

  const sheets = (
    <>
      {bookActions !== null && (
        <BookSheet
          card={bookActions}
          progress={reading.get(bookActions.book.id) ?? null}
          groups={shelf.series}
          onOpen={isHidden ? undefined : () => openFromShelf(bookActions)}
          onFinished={setFinished}
          onSeries={setSeries}
          onEditSeries={setSeriesEdit}
          onRemove={(id) => {
            if (!isHidden) {
              removeWithFall(id);
              return;
            }

            // The reader of a deleted book has nothing to show, so it closes first.
            slideTo(navigate, "/", "out");
            remove(id);
          }}
          onReparse={reparse}
          onCover={setCover}
          onResetCover={resetCover}
          onClose={() => setBookActions(null)}
        />
      )}

      {seriesEdit !== null && (
        <SeriesSheet
          series={seriesEdit}
          stored={series.find((record) => record.id === seriesEdit.id)}
          cards={shelf.cards}
          groups={shelf.series}
          onSave={editSeries}
          onRemove={removeSeries}
          onClose={() => setSeriesEdit(null)}
        />
      )}
    </>
  );

  return (
    // A fixed column with its own scroll box, so the window never scrolls. Hidden, it keeps its layout.
    <main
      className={`fixed inset-x-0 top-0 flex h-(--app-height) flex-col bg-(--bg) text-(--ink) ${hiddenClass(isHidden)}`}
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
          className="mx-auto flex min-h-[calc(100%+1px)] w-full max-w-[1180px] flex-col pt-(--safe-top) pb-[calc(var(--safe-bottom)+6.5rem)] md:pb-8"
        >
          <LibraryHeader
            query={query}
            isBusy={isBusy}
            isSearchOpen={isSearchOpen}
            onQuery={setQuery}
            onSearchOpen={setSearchOpen}
            onSettings={() => setSettingsOpen(true)}
            onAdd={pickFiles}
          />

          <LibraryNotices message={message} hasFailed={state.status === "error"} />

          {isEmpty ? (
            <EmptyShelf isDropping={isDropping} isBusy={isBusy} onAdd={pickFiles} />
          ) : (
            <ShelfTop
              isLoaded={isLoaded}
              continuing={isShelfPlain ? continuingCards(shelf, reading) : []}
              adding={
                isBusy ? (
                  <ProgressPanel
                    progress={progress}
                    onCancel={isImporting ? cancelImport : undefined}
                  />
                ) : null
              }
              shelf={shelf}
              status={filters.status}
              sort={settings.librarySort}
              onOpen={open}
              onStatus={(status) => setFilters({ ...emptyFilters, status })}
              onSort={(sort) => update({ librarySort: sort })}
            />
          )}

          <div
            ref={listRef}
            className="relative mx-4.5 mr-5.5 md:mx-8 md:mr-9"
            style={{ height: virtualizer.getTotalSize() }}
          >
            <LibraryRows
              virtualizer={virtualizer}
              rows={rows}
              columns={columns}
              listTop={listTop}
              isDealing={isDealing}
              openSeries={openSeries}
              events={events}
            />
          </div>

          <ShelfFooter
            hasNoMatches={shelf.items.length === 0 && books.length > 0}
            query={query}
            status={filters.status}
            showsInstall={isInstallHintShown && !isEmpty}
            onClear={() => {
              setQuery("");
              setFilters(emptyFilters);
            }}
            onDismissInstall={() => {
              setInstallHintShown(false);

              try {
                localStorage.setItem(installHintKey, "1");
              } catch {
                // Without storage the hint comes back on the next launch.
              }
            }}
          />
        </div>
      </div>

      <AddControls hasShelf={!isEmpty} isDropping={isDropping} isBusy={isBusy} onAdd={pickFiles} />

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

      <SettingsSheet
        isOpen={settingsOpen}
        estimate={estimate}
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

      {/* The shelf is hidden under an open book, so a sheet asked for from the reader goes over it. */}
      {isHidden ? createPortal(sheets, document.body) : sheets}
    </main>
  );
}
