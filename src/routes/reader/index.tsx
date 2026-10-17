import { Effect, Option, Schema } from "effect";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  forkApp,
  runApp,
  stopFiber,
  useAiSettings,
  useAppEffect,
  useFigureJobs,
  useSettings,
  useSummary,
} from "@/lib/hooks";
import { hasConsent } from "@/domain/ai";
import { BookPrefs, ReaderSettings, TOUR_VERSION } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { shelfRecords } from "@/lib/shelf";
import { holdWakeLock } from "@/lib/wake-lock";
import { Tour } from "@/routes/library/_Tour";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { SummaryJobs } from "@/services/summary-jobs";
import { saveBookPrefs } from "@/use-cases/book-prefs";
import { watchParsedBook } from "@/use-cases/parse-book";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { findBookSeries } from "@/use-cases/series";
import { pendingVolumes } from "@/use-cases/summary";
import { ReaderNav } from "./_ReaderNav";
import { ReaderBody } from "./_ReaderBody";
import { ReaderStatus } from "./_ReaderStatus";
import { ReaderSheets } from "./_ReaderSheets";
import {
  describePageLabels,
  useBookKind,
  useBookSeries,
  useBookSettings,
  useReaderMode,
  useSummaryView,
} from "./_use-reader-derived";
import { useReaderKeys } from "./_use-reader-keys";
import { useReaderRepair } from "./_use-reader-repair";
import type { JumpRequest } from "./_ReaderView";

const SAVE_DELAY_MS = 400;

function readerKeysEnabled(
  isTocOpen: boolean,
  isSheetOpen: boolean,
  isSeriesOpen: boolean,
  tour: number | undefined,
): boolean {
  return !isTocOpen && !isSheetOpen && !isSeriesOpen && (tour ?? 0) >= TOUR_VERSION;
}

export function ReaderRoute({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  // Until the book loads, its first frames take its theme, title and place from the library.
  const [glance] = useState(() => shelfRecords.get(bookId));

  const { state, reload } = useAppEffect(
    Effect.gen(function* () {
      const store = yield* BookStore;
      // Four independent reads, so the open waits for the slowest one instead of the sum.
      const [meta, parsed, progress, prefs] = yield* Effect.all(
        [
          store.get(bookId),
          store.getParsed(bookId),
          store.getProgress(bookId),
          store
            .getPrefs(bookId)
            .pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null))),
        ],
        { concurrency: "unbounded" },
      );

      return { meta, parsed, progress, prefs };
    }),
    [bookId],
  );

  const loadError = state.status === "error" ? state.error : null;
  const { isRepairing, message, rebuild } = useReaderRepair({ bookId, loadError, reload });

  const [showChrome, setChrome] = useState(true);
  const [isTocOpen, setTocOpen] = useState(false);
  const [prefChanges, setPrefChanges] = useState<Partial<BookPrefs>>({});
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [reported, setReported] = useState<number | null>(null);
  // The summary follows the furthest block, so going back over earlier pages asks for nothing.
  const [furthest, setFurthest] = useState(0);
  const furthestRef = useRef(0);
  const { ai, putAi } = useAiSettings();
  const {
    summary,
    isLoaded: summaryLoaded,
    run,
    error: summaryError,
    start,
    stop,
    discard,
    addName,
    editName,
  } = useSummary(bookId);
  const [summarySheet, setSummarySheet] = useState<{ openAt: number | null } | null>(null);
  const [isSeriesOpen, setSeriesOpen] = useState(false);

  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<(() => void) | null>(null);
  const totalRef = useRef(1);

  useEffect(() => {
    const fiber = forkApp(holdWakeLock());
    return () => stopFiber(fiber);
  }, []);

  useEffect(() => {
    const fiber = forkApp(watchParsedBook(bookId, () => reload()));
    return () => stopFiber(fiber);
  }, [bookId, reload]);

  const data = state.status === "done" ? state.value : null;
  // After the book shows, so the lookup does not slow its open.
  const isLoaded = data !== null;
  const { series, seriesId, seriesJob, reloadSeries } = useBookSeries(bookId, isLoaded);

  // The saved place until a view reports one, so the original view opens at the saved page.
  const position = reported ?? data?.progress?.blockIndex ?? 0;

  useEffect(() => {
    const stored = data?.progress;

    if (stored === undefined || stored === null) return;

    furthestRef.current = Math.max(furthestRef.current, stored.furthest ?? stored.blockIndex);
    setFurthest(furthestRef.current);
  }, [data]);

  const { prefs, bookSettings } = useBookSettings(settings, data, glance, prefChanges);

  useReaderKeys({
    isEnabled: readerKeysEnabled(
      isTocOpen,
      summarySheet !== null,
      isSeriesOpen,
      settings.readerTour,
    ),
    isSearchOpen,
    setSearchOpen,
    setTocOpen,
    navigate,
    fontSize: bookSettings.fontSize,
    lineHeight: bookSettings.lineHeight,
  });

  const { guessed, kind, isEpub, isTouring, tourSteps } = useBookKind(
    data,
    prefs,
    settings.readerTour,
  );
  const {
    chapterList,
    isFinished,
    cover,
    readingCover,
    summaryInput,
    autoSummaryInput,
    summaryText,
    lines,
  } = useSummaryView({ data, ai, summary, run, kind, position, furthest });

  // Once per finished chapter, so Stop and Discard hold until the reader finishes the next one.
  const autoTarget = useRef(-1);

  useEffect(() => {
    // Not before the stored summary is read, which may already hold this chapter.
    if (!hasConsent(ai) || !ai.autoSummary || !summaryLoaded || autoSummaryInput === null) {
      return;
    }
    // An error waits for a tap in the sheet, so a failing provider is not asked again and again.
    if (run !== null || summaryError !== null || seriesJob.run !== null || !navigator.onLine) {
      return;
    }
    if (readingCover.target <= autoTarget.current) return;

    autoTarget.current = readingCover.target;
    if ((summary?.chapters.length ?? 0) >= readingCover.target) return;

    start(autoSummaryInput, ai);
  }, [
    ai,
    autoSummaryInput,
    summaryLoaded,
    run,
    summaryError,
    seriesJob.run,
    summary,
    readingCover.target,
    start,
  ]);

  // After the book's own job catches up, once per finished chapter, on Finished, and on open for earlier volumes.
  const seriesTarget = useRef(-1);

  useEffect(() => {
    if (!hasConsent(ai) || !ai.autoSummary || seriesId === null) {
      return;
    }
    if (
      run !== null ||
      summaryError !== null ||
      seriesJob.run !== null ||
      seriesJob.error !== null
    ) {
      return;
    }
    if (!navigator.onLine || (summary?.chapters.length ?? 0) < readingCover.target) return;

    const target = isFinished ? Number.POSITIVE_INFINITY : readingCover.target;

    if (target <= seriesTarget.current) return;

    const opening = seriesTarget.current === -1;

    seriesTarget.current = target;

    // Read again, so the statuses include this visit's reading and a first open counts as started.
    const program = Effect.gen(function* () {
      const series = yield* findBookSeries(bookId);

      if (series === null) return;
      if ((yield* pendingVolumes(series, opening ? bookId : undefined)) === 0) return;

      yield* (yield* SummaryJobs).startSeries(series, bookId, ai);
    });

    forkApp(program.pipe(Effect.catchTag("StorageFailure", () => Effect.void)));
  }, [
    ai,
    seriesId,
    bookId,
    run,
    summaryError,
    seriesJob,
    summary,
    readingCover.target,
    isFinished,
  ]);

  // A PDF may switch to the original view, so its page renderer loads its scripts at startup.
  useEffect(() => {
    if (data === null || isEpub) return;

    void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
  }, [data, isEpub]);

  const { mode, showsPages, pendingBooks, startPage } = useReaderMode({
    data,
    isEpub,
    prefs,
    guessed,
  });

  useFigureJobs(pendingBooks, startPage);

  // Runs after useSettings applies the global theme, so this book's own theme wins while it is open.
  useLayoutEffect(() => {
    const root = document.documentElement;

    root.dataset.theme = bookSettings.theme;
    root.style.setProperty("--temperature", String(bookSettings.temperature));

    // The library stays mounted under the book, so it takes the global theme back from here.
    return () => {
      root.dataset.theme = settings.theme;
      root.style.setProperty("--temperature", String(settings.temperature));
    };
  }, [bookSettings.theme, bookSettings.temperature, settings.theme, settings.temperature]);

  const savePrefs = (changes: Partial<BookPrefs>): void => {
    const next = { ...prefChanges, ...changes };

    setPrefChanges(next);
    // The whole visit's changes, so saves that land out of order lose none.
    void runApp(saveBookPrefs(bookId, next).pipe(Effect.ignore));
  };
  // Saves to this book. A text choice also goes global for new books, but Settings owns the theme.
  const changeSettings = (patch: Partial<ReaderSettings>): void => {
    const changes = Schema.decodeUnknownOption(BookPrefs)(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    );

    if (Option.isSome(changes)) savePrefs(changes.value);
    if (patch.theme === undefined && patch.temperature === undefined) update(patch);
  };

  // A launch into a book that is gone should not open it again.
  useEffect(() => {
    if (loadError?._tag !== "BookNotFound") return;

    try {
      localStorage.removeItem("last-screen");
    } catch {
      // Without storage the launch opens the library.
    }
  }, [loadError]);

  const { title, toc, total, shown, percentLabel } = describePageLabels(
    data,
    glance,
    position,
    formatPercent,
  );

  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  // Stable, or every position change rebuilds the reader's observer over every block.
  const onPosition = useCallback(
    (blockIndex: number) => {
      setReported(blockIndex);

      if (blockIndex > furthestRef.current) {
        furthestRef.current = blockIndex;
        setFurthest(blockIndex);
      }

      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);

      const save = (): void => {
        pendingSave.current = null;
        saveTimer.current = null;
        void runApp(saveReadingProgress(bookId, blockIndex, totalRef.current, furthestRef.current));
      };

      pendingSave.current = save;
      saveTimer.current = window.setTimeout(save, SAVE_DELAY_MS);
    },
    [bookId],
  );

  // iOS suspends a hidden app and often kills it from there, so a pending save runs at once.
  useEffect(() => {
    const flush = (): void => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      pendingSave.current?.();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const toggleMode = (): void => {
    setSearchOpen(false);
    // The other view mounts at the place being read, not at the last Contents entry.
    setJump(null);
    savePrefs({ mode: mode === "reader" ? "original" : "reader" });
  };
  // The search goes through the parsed text, so a scanned book, which has none, has no search.
  const searchable = showsPages && data?.meta.parseState !== "scanned";
  const toggleChrome = useCallback(() => setChrome((value) => !value), []);
  const closeToc = () => setTocOpen(false);
  // Contents goes to the entry in the view showing. It never switches the view.
  const selectToc = (blockIndex: number) => {
    setTocOpen(false);
    setJump({ index: blockIndex, nonce: Date.now() });
  };

  const modeLabel = mode === "reader" ? "Original view" : "Reader view";
  const contentClass = showChrome
    ? "h-full pt-[var(--safe-top)] md:pt-[calc(5.5rem+var(--safe-top))]"
    : "h-full pt-[var(--safe-top)]";

  return (
    <div className="relative h-[var(--app-height)] bg-base-100">
      <div className={contentClass}>
        <ReaderStatus
          status={state.status}
          error={loadError}
          isRepairing={isRepairing}
          title={title}
          onRebuild={rebuild}
        />

        {data !== null && (
          <ReaderBody
            meta={data.meta}
            parsed={data.parsed}
            position={position}
            onPosition={onPosition}
            mode={mode}
            showChrome={showChrome}
            settings={bookSettings}
            jump={jump}
            isSearching={isSearchOpen && searchable}
            onCloseSearch={() => setSearchOpen(false)}
            onToggleChrome={toggleChrome}
          />
        )}
      </div>

      <ReaderNav
        title={title}
        showChrome={showChrome}
        percentLabel={percentLabel}
        position={shown}
        total={total}
        onMenu={() => setTocOpen(true)}
        onSearch={searchable ? () => setSearchOpen(true) : undefined}
      />

      {data !== null && isTouring && (
        <Tour steps={tourSteps} onDone={() => update({ readerTour: TOUR_VERSION })} />
      )}

      {message !== null && (
        <div className="absolute inset-x-0 bottom-[calc(7.5rem+var(--safe-bottom))] z-40 px-3 md:bottom-[calc(4rem+var(--safe-bottom))]">
          <div className="alert py-2 text-sm alert-warning">
            <span>{message}</span>
          </div>
        </div>
      )}

      <ReaderSheets
        isTocOpen={isTocOpen}
        toc={toc}
        modeLabel={modeLabel}
        bookSettings={bookSettings}
        summaryText={summaryText}
        run={run}
        stop={stop}
        series={series}
        seriesJob={seriesJob}
        reloadSeries={reloadSeries}
        setSeriesOpen={setSeriesOpen}
        seriesId={seriesId}
        lines={lines}
        onSelect={selectToc}
        chapterList={chapterList}
        setSummarySheet={setSummarySheet}
        isEpub={isEpub}
        toggleMode={toggleMode}
        changeSettings={changeSettings}
        closeToc={closeToc}
        summarySheet={summarySheet}
        summaryInput={summaryInput}
        cover={cover}
        ai={ai}
        summary={summary}
        summaryError={summaryError}
        savePrefs={savePrefs}
        start={start}
        discard={discard}
        addName={addName}
        editName={editName}
        putAi={putAi}
        setTocOpen={setTocOpen}
        isSeriesOpen={isSeriesOpen}
        bookId={bookId}
      />
    </div>
  );
}
