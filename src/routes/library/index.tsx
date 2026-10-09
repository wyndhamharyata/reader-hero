import { useVirtualizer } from "@tanstack/react-virtual";
import { Effect, Stream } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useLocation } from "react-router";
import { CogIcon, FunnelIcon, PlusIcon } from "@/components/icons";
import { fontFamily } from "@/domain/book";
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
import {
  buildShelf,
  shelfRecords,
  type FilterGroup,
  type Filters,
  type LibraryCard,
  type Shelf,
} from "@/lib/shelf";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { ensureCovers } from "@/use-cases/book-image";
import type { ParseProgress } from "@/use-cases/extract";
import { importBooks } from "@/use-cases/import-books";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";
import { setBookFinished } from "@/use-cases/save-progress";
import { hideSeries, saveSeries, setBookSeries } from "@/use-cases/series";
import { describeError } from "@/lib/describe-error";
import { BookSheet } from "./_BookSheet";
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
import { SeriesCard } from "./_SeriesCard";
import { SeriesSheet } from "./_SeriesSheet";
import { SeriesTile } from "./_SeriesTile";
import { SettingsSheet } from "./_SettingsSheet";
import { SortMenu } from "./_SortMenu";
import { StorageUsage } from "./_StorageUsage";
import type { TrayFlags } from "./_TrayPart";
import { ViewToggle } from "./_ViewToggle";

const showInstallHint = isIosBrowser && !isInstalled;

// `hidden` while a book is open over it: it keeps its state, and pauses its background jobs.
export function LibraryRoute({ hidden }: { hidden: boolean }): ReactElement {
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const importJob = useRef<Job | null>(null);
  const [query, setQuery] = useState("");
  const [mobileSearchAndFiltersVisible, setMobileSearchAndFiltersVisible] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookActions, setBookActions] = useState<LibraryCard | null>(null);
  // A null id is a new series from the Book sheet.
  const [seriesEdit, setSeriesEdit] = useState<{
    id: string | null;
    name: string;
    books: ReadonlyArray<LibraryCard>;
  } | null>(null);
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
  const [trayVisibleId, setTrayVisibleId] = useState<string | null>(null);
  const [seriesTransitioning, setSeriesTransitioning] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    status: null,
    length: null,
    author: null,
  });
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const layoutBefore = useRef<Map<string, { left: number; top: number }> | null>(null);
  const pendingLayout = useRef(false);
  const transitioning = useRef(false);
  const motionTimer = useRef<number | null>(null);
  const motionAnimations = useRef<Array<Animation>>([]);

  // Keep the mobile search and chips out of the way while scrolling down, but bring them back
  // as soon as the reader scrolls up. The mobile action row stays visible either way.
  useEffect(() => {
    const box = scrollRef.current;
    if (box === null) return;

    const mobile = window.matchMedia("(width < 48rem)");
    const readPosition = () => {
      const height = box.clientHeight;
      const end = Math.max(0, box.scrollHeight - height);
      return { top: Math.min(Math.max(box.scrollTop, 0), end), height, end };
    };
    let previous = readPosition();
    const onScroll = (): void => {
      const current = readPosition();

      if (current.top <= 0) {
        setMobileSearchAndFiltersVisible(true);
        previous = current;
        return;
      }

      // Ignore elastic overscroll and position clamps caused by a change to the scroll range.
      if (current.height !== previous.height || current.end !== previous.end) {
        previous = current;
        return;
      }

      if (!mobile.matches) {
        previous = current;
        return;
      }

      const delta = current.top - previous.top;
      if (Math.abs(delta) >= 24) {
        const searchFocused = document.activeElement?.matches('input[type="search"]') ?? false;
        // Keep a focused search field available while its keyboard is open.
        if (delta < 0 || !searchFocused) setMobileSearchAndFiltersVisible(delta < 0);
        previous = current;
      }
    };
    const onBreakpointChange = (): void => {
      previous = readPosition();
      setMobileSearchAndFiltersVisible(true);
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    mobile.addEventListener("change", onBreakpointChange);
    return () => {
      box.removeEventListener("scroll", onScroll);
      mobile.removeEventListener("change", onBreakpointChange);
    };
  }, []);

  // With the keyboard up the library takes only the visible area, so its bar sits on the keyboard.
  useEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;
    if (root === null || viewport === null) return;
    const html = document.documentElement;
    let typing = false;
    const fit = (): void => {
      root.style.height = typing ? `${viewport.height}px` : "";
      // iOS scrolls the window, and its viewport offset lags behind, stale for a while after the close.
      const shift = typing ? Math.max(window.scrollY, viewport.offsetTop) : window.scrollY;
      root.style.top = shift > 0 ? `${shift}px` : "";
      // The page is no taller than what shows and does not scroll, so iOS has less to move.
      html.style.height = typing ? `${viewport.height}px` : "";
      html.style.overflow = typing ? "hidden" : "";
      // The root's clientHeight stays the full screen with the keyboard up; innerHeight shrinks with it.
      const covered = html.clientHeight - viewport.height;
      if (typing && covered > 0) {
        try {
          localStorage.setItem("keyboard-height", String(covered));
        } catch {
          // Without storage, the next focus shrinks the column only once the keyboard is up.
        }
      }
    };
    const onFocus = (event: FocusEvent): void => {
      typing = event.type === "focusin" && (event.target as Element).matches("input, textarea");
      const known = (() => {
        try {
          return Number(localStorage.getItem("keyboard-height") ?? 0);
        } catch {
          return 0;
        }
      })();
      // At once while it opens, so iOS sees the field's final place; the close slides with the keyboard.
      root.style.transition = typing ? "none" : "";
      // Shrunk before iOS opens the keyboard, the field is already in view, so iOS does not move the page.
      if (typing && known > 0 && html.clientHeight - viewport.height < 1) {
        root.style.height = `${html.clientHeight - known}px`;
        html.style.height = `${html.clientHeight - known}px`;
        html.style.overflow = "hidden";
      } else {
        fit();
      }
    };
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onFocus);
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    window.addEventListener("scroll", fit);
    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onFocus);
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      window.removeEventListener("scroll", fit);
    };
  }, []);

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;
  const reading = state.status === "done" ? state.value.reading : null;
  const series = state.status === "done" ? state.value.series : [];
  useFigureJobs(hidden ? [] : books);

  // Back from a book, the shelf reads again, so its statuses show the reading just done.
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden) reload();
    wasHidden.current = hidden;
  }, [hidden, reload]);
  // Keyed on the ids, so the frequent meta reloads during parsing do not restart the cover job.
  const bookIds = books.map((book) => book.id).join(" ");

  useEffect(() => {
    if (hidden || bookIds === "") return;
    const fiber = forkApp(ensureCovers(bookIds.split(" ")));
    return () => stopFiber(fiber);
  }, [hidden, bookIds]);

  // A book's text waits for its font, so the reading fonts load with the library.
  useEffect(() => {
    for (const family of Object.values(fontFamily)) void document.fonts.load(`1em "${family}"`);
  }, []);

  // With a PDF on the shelf and no figure job running, the page renderer loads its scripts now,
  // after the launch work has settled, so the original view opens without that wait later.
  const hasPdf = books.some((book) => book.format !== "epub");
  const figuresBusy = books.some((book) => book.figuresPending);
  useEffect(() => {
    if (hidden || !hasPdf || figuresBusy) return;
    const timer = window.setTimeout(() => {
      void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [hidden, hasPdf, figuresBusy]);

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
          // A save as the book closes can land after the reread above; while hidden, it waits for it.
          Stream.filter(
            (update) =>
              update.kind === "meta" ||
              update.kind === "series" ||
              (update.kind === "progress" && !hidden),
          ),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [hidden, reload]);

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
    () => buildShelf(books, reading ?? new Map(), query, filters, settings.librarySort, series),
    [books, reading, query, filters, settings.librarySort, series],
  );
  const items = useMemo(() => {
    const items: Array<
      Shelf["items"][number] | { readonly kind: "member"; readonly card: LibraryCard }
    > = [];
    for (const item of shelf.items) {
      items.push(item);
      if (item.kind !== "series" || item.id !== openSeriesId) continue;
      for (const card of item.books) items.push({ kind: "member", card });
    }
    return items;
  }, [shelf, openSeriesId]);
  const cards = useMemo(
    () => items.flatMap((item) => (item.kind === "series" ? [] : [item.card])),
    [items],
  );

  // The grid's breakpoints: 2 columns, 3 from sm, 5 from md; a list has 1, or 2 from md.
  const [wide, setWide] = useState(() => ({
    sm: window.matchMedia("(width >= 40rem)").matches,
    md: window.matchMedia("(width >= 48rem)").matches,
  }));
  useEffect(() => {
    const sm = window.matchMedia("(width >= 40rem)");
    const md = window.matchMedia("(width >= 48rem)");
    const follow = (): void => setWide({ sm: sm.matches, md: md.matches });
    sm.addEventListener("change", follow);
    md.addEventListener("change", follow);
    return () => {
      sm.removeEventListener("change", follow);
      md.removeEventListener("change", follow);
    };
  }, []);
  const columns = grid ? (wide.md ? 5 : wide.sm ? 3 : 2) : wide.md ? 2 : 1;
  const capturePositions = (): Map<string, { left: number; top: number }> => {
    const positions = new Map<string, { left: number; top: number }>();
    const list = listRef.current;
    if (list === null) return positions;
    for (const element of list.querySelectorAll<HTMLElement>("[data-layout-id]")) {
      const id = element.dataset.layoutId;
      if (id === undefined) continue;
      const rect = element.getBoundingClientRect();
      positions.set(id, { left: rect.left, top: rect.top });
    }
    return positions;
  };
  const toggleSeries = (id: string): void => {
    if (transitioning.current) return;
    const list = listRef.current;
    if (openSeriesId === null) {
      layoutBefore.current = capturePositions();
      pendingLayout.current = true;
      transitioning.current = true;
      setSeriesTransitioning(true);
      setTrayVisibleId(null);
      setOpenSeriesId(id);
      return;
    }

    const nextSeriesId = openSeriesId === id ? null : id;
    const root =
      list === null
        ? undefined
        : [...list.querySelectorAll<HTMLElement>("[data-series-root]")].find(
            (element) => element.dataset.seriesRoot === openSeriesId,
          );
    const members =
      list === null
        ? []
        : [...list.querySelectorAll<HTMLElement>("[data-series-member]")].filter(
            (element) => element.dataset.seriesMember === openSeriesId,
          );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || root === undefined || members.length === 0) {
      layoutBefore.current = capturePositions();
      pendingLayout.current = true;
      transitioning.current = true;
      setSeriesTransitioning(true);
      setTrayVisibleId(null);
      setOpenSeriesId(nextSeriesId);
      return;
    }

    layoutBefore.current = capturePositions();
    const rootPosition = layoutBefore.current.get(`series:${openSeriesId}`);
    const origin = rootPosition ?? {
      left: root.getBoundingClientRect().left,
      top: root.getBoundingClientRect().top,
    };
    for (const [index, member] of members.entries()) {
      const id = member.dataset.layoutId;
      const position = id === undefined ? undefined : layoutBefore.current.get(id);
      if (position === undefined) continue;
      motionAnimations.current.push(
        member.animate(
          [
            { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
            {
              transform: `translate3d(${origin.left - position.left}px, ${origin.top - position.top}px, 0) scale(0.65)`,
              opacity: 0,
            },
          ],
          {
            duration: 200,
            delay: index * 30,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
            fill: "forwards",
          },
        ),
      );
    }
    transitioning.current = true;
    setSeriesTransitioning(true);
    motionTimer.current = window.setTimeout(
      () => {
        motionTimer.current = null;
        setTrayVisibleId(null);
        motionTimer.current = window.setTimeout(() => {
          motionTimer.current = null;
          layoutBefore.current = capturePositions();
          pendingLayout.current = true;
          setOpenSeriesId(nextSeriesId);
        }, 150);
      },
      200 + Math.max(0, members.length - 1) * 30,
    );
  };
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
        items.slice(row * columns, (row + 1) * columns),
      ),
    [items, columns],
  );

  useLayoutEffect(() => {
    if (!pendingLayout.current) return;
    pendingLayout.current = false;
    const before = layoutBefore.current ?? new Map<string, { left: number; top: number }>();
    layoutBefore.current = null;
    const list = listRef.current;
    if (list === null) {
      transitioning.current = false;
      setSeriesTransitioning(false);
      return;
    }
    const seriesRoot =
      openSeriesId === null
        ? undefined
        : [...list.querySelectorAll<HTMLElement>("[data-series-root]")].find(
            (element) => element.dataset.seriesRoot === openSeriesId,
          );
    const newMembers =
      openSeriesId === null
        ? []
        : [...list.querySelectorAll<HTMLElement>("[data-series-member]")].filter(
            (element) =>
              element.dataset.seriesMember === openSeriesId &&
              !before.has(element.dataset.layoutId ?? ""),
          );
    const scroll = scrollRef.current;
    const firstMember = newMembers[0];
    if (seriesRoot !== undefined && firstMember !== undefined && scroll !== null) {
      const firstRect = firstMember.getBoundingClientRect();
      const view = scroll.getBoundingClientRect();
      if (firstRect.bottom > view.bottom) {
        const previousScroll = scroll.scrollTop;
        const rootRect = seriesRoot.getBoundingClientRect();
        scroll.scrollTo({ top: previousScroll + rootRect.top - view.top, behavior: "auto" });
        const delta = scroll.scrollTop - previousScroll;
        for (const [id, position] of before) {
          before.set(id, { left: position.left, top: position.top - delta });
        }
      }
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      motionAnimations.current = [];
      setTrayVisibleId(openSeriesId);
      transitioning.current = false;
      setSeriesTransitioning(false);
      return;
    }

    motionAnimations.current = [];
    for (const element of list.querySelectorAll<HTMLElement>("[data-layout-id]")) {
      const id = element.dataset.layoutId;
      const position = id === undefined ? undefined : before.get(id);
      if (position === undefined) continue;
      const rect = element.getBoundingClientRect();
      const x = position.left - rect.left;
      const y = position.top - rect.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      motionAnimations.current.push(
        element.animate(
          [{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        ),
      );
    }

    const origin = seriesRoot?.getBoundingClientRect();
    for (const [index, element] of newMembers.entries()) {
      if (origin === undefined) break;
      const rect = element.getBoundingClientRect();
      const x = origin.left - rect.left;
      const y = origin.top - rect.top;
      motionAnimations.current.push(
        element.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0) scale(0.7)`, opacity: 0 },
            { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
          ],
          {
            duration: 200,
            delay: index * 30,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          },
        ),
      );
    }
    const duration = 200 + Math.max(0, newMembers.length - 1) * 30;
    motionTimer.current = window.setTimeout(() => {
      motionTimer.current = null;
      motionAnimations.current = [];
      setTrayVisibleId(openSeriesId);
      transitioning.current = false;
      setSeriesTransitioning(false);
    }, duration);
  }, [items, openSeriesId]);

  useEffect(() => {
    if (!hidden) return;
    if (motionTimer.current !== null) window.clearTimeout(motionTimer.current);
    motionTimer.current = null;
    for (const animation of motionAnimations.current) animation.cancel();
    motionAnimations.current = [];
    layoutBefore.current = null;
    pendingLayout.current = false;
    transitioning.current = false;
    setSeriesTransitioning(false);
    setTrayVisibleId(openSeriesId);
  }, [hidden, openSeriesId]);

  useEffect(
    () => () => {
      if (motionTimer.current !== null) window.clearTimeout(motionTimer.current);
      for (const animation of motionAnimations.current) animation.cancel();
    },
    [],
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
    // A first guess only: each row is measured once it renders.
    estimateSize: () => (grid ? 320 : 132),
    overscan: 3,
    scrollMargin: listTop,
  });
  // A row of another view or width has another height, so the measured ones no longer hold.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, grid, columns]);

  // A new search or filter shows its results from the top.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, filters]);

  // Back from a book the shelf stays, unless the sort moved the book out of view; then it shows it.
  const { pathname } = useLocation();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (hidden) opened.current = pathname;
  }, [hidden, pathname]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const index = cards.findIndex((card) => `/book/${card.book.id}` === opened.current);
    if (hidden || box === null || index === -1) return;
    const card = box.querySelector(`a[href="${opened.current}"]`)?.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (card !== undefined && card.bottom > view.top && card.top < view.bottom) return;
    // The first row goes up with the header above it.
    if (index < columns) box.scrollTo({ top: 0 });
    else virtualizer.scrollToIndex(Math.floor(index / columns), { align: "start" });
  }, [hidden, cards, columns, virtualizer]);
  // Until the reader moves the shelf themselves.
  useEffect(() => {
    if (hidden) return;
    const release = (): void => {
      opened.current = null;
    };
    for (const type of ["pointerdown", "wheel", "keydown"]) window.addEventListener(type, release);
    return () => {
      for (const type of ["pointerdown", "wheel", "keydown"])
        window.removeEventListener(type, release);
    };
  }, [hidden]);

  const clearFilters = (): void => setFilters({ status: null, length: null, author: null });
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
  const openSeries = shelf.items.find((item) => item.kind === "series" && item.id === openSeriesId);
  const trayStart =
    openSeries?.kind === "series"
      ? items.findIndex((item) => item.kind === "series" && item.id === openSeries.id)
      : -1;
  const trayEnd = openSeries?.kind === "series" ? trayStart + openSeries.books.length : -1;

  return (
    // A fixed column with its own scroll box, so the window never scrolls; hidden, it keeps its layout.
    <main
      ref={rootRef}
      // When the keyboard closes, the column grows back at about the keyboard's pace.
      className={`fixed inset-x-0 top-0 flex h-(--app-height) flex-col bg-base-100 motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out ${hidden ? "invisible" : ""}`}
      data-series-transitioning={seriesTransitioning}
      inert={hidden}
      aria-hidden={hidden}
    >
      <div
        ref={scrollRef}
        data-library-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] pb-8 md:max-w-5xl">
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

          <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
              <ul
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                // Above the next row while a tile's menu is open, so the menu is not under it.
                className={`absolute inset-x-0 top-0 grid gap-x-3 focus-within:z-10 ${grid ? "pb-5" : "pb-3"}`}
                style={{
                  transform: `translateY(${row.start - listTop}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rows[row.index]?.map((item, column) => {
                  const itemIndex = row.index * columns + column;
                  const tray: TrayFlags | null =
                    trayStart < 0 || itemIndex < trayStart || itemIndex > trayEnd
                      ? null
                      : {
                          firstOnTray: itemIndex === trayStart,
                          lastOnTray: itemIndex === trayEnd,
                          firstColumn: itemIndex % columns === 0,
                          lastColumn: itemIndex % columns === columns - 1,
                          columns,
                          visible: trayVisibleId === openSeriesId,
                        };
                  if (item.kind === "series") {
                    const props = {
                      series: item,
                      expanded: item.id === openSeriesId,
                      onToggle: () => toggleSeries(item.id),
                      onActions: () => setSeriesEdit(item),
                      tray,
                    };
                    return grid ? (
                      <SeriesTile key={`series:${item.id}`} {...props} />
                    ) : (
                      <SeriesCard key={`series:${item.id}`} {...props} />
                    );
                  }
                  const seriesMember = item.kind === "member";
                  return grid ? (
                    <BookTile
                      key={`book:${item.card.book.id}`}
                      card={item.card}
                      onActions={() => setBookActions(item.card)}
                      seriesMember={seriesMember}
                      tray={tray}
                    />
                  ) : (
                    <BookCard
                      key={`book:${item.card.book.id}`}
                      card={item.card}
                      onActions={() => setBookActions(item.card)}
                      seriesMember={seriesMember}
                      tray={tray}
                    />
                  );
                })}
              </ul>
            ))}
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

      <div className="flex shrink-0 flex-col border-t border-base-300 bg-base-100 px-4 pt-2 pb-[calc(var(--safe-bottom)+0.5rem)] has-[input:focus]:pb-2 md:hidden">
        <div
          className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
            mobileSearchAndFiltersVisible
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
          aria-hidden={!mobileSearchAndFiltersVisible}
          inert={!mobileSearchAndFiltersVisible}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-2 pb-2">
              {searchField}
              {filterChips}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewToggle}
          {sortMenu}
          <button
            type="button"
            className="btn relative btn-square"
            aria-label="All filters"
            title="All filters"
            onClick={() => setFiltersOpen(true)}
          >
            <FunnelIcon className="size-6" />
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

      {bookActions !== null && (
        <BookSheet
          card={bookActions}
          groups={shelf.series}
          onFinished={(id, finished) => {
            setMessage(null);
            void runApp(
              setBookFinished(id, finished).pipe(
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

      {busy && (
        <ProgressPanel progress={progress} onCancel={importing ? cancelImport : undefined} />
      )}
    </main>
  );
}
