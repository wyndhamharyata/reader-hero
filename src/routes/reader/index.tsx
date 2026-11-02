import { Effect, Option, Schema } from "effect";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { AiSettings, CONSENT_VERSION } from "@/domain/ai";
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
import { BookPrefs, ReaderSettings } from "@/domain/book";
import { maxMatches, type BlockMatch } from "@/lib/find-text";
import { formatPercent } from "@/lib/format";
import { sheetRequest, shelfRecords } from "@/lib/shelf";
import { slideTo } from "@/lib/slide-to";
import { holdWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { SummaryJobs } from "@/services/summary-jobs";
import { saveBookPrefs } from "@/use-cases/book-prefs";
import { watchParsedBook } from "@/use-cases/parse-book";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { findBookSeries } from "@/use-cases/series";
import { pendingVolumes } from "@/use-cases/summary";
import { ContentsPanel, type ContentsTab } from "./_ContentsPanel";
import { FindBar } from "./_FindBar";
import { LookPanel } from "./_LookPanel";
import { MorePanel } from "./_MorePanel";
import { ReaderBars, type ReaderPanel } from "./_ReaderBars";
import { ReaderBody } from "./_ReaderBody";
import { ReaderStatus } from "./_ReaderStatus";
import { SummaryPanel } from "./_SummaryPanel";
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

type OpenPanel =
  | { readonly kind: "none" }
  | { readonly kind: "contents"; readonly tab: ContentsTab }
  | { readonly kind: "summary"; readonly openAt: number | null }
  | { readonly kind: "look"; readonly view: "look" | "more" }
  | { readonly kind: "more" };

const noPanel: OpenPanel = { kind: "none" };

type BookFind = {
  readonly query: string;
  readonly matches: ReadonlyArray<BlockMatch>;
  readonly at: number;
};

function matchOf(find: BookFind | null): BlockMatch | null {
  return find === null ? null : (find.matches[find.at] ?? null);
}

function stepped(find: BookFind, by: 1 | -1): BookFind {
  const count = find.matches.length;

  return count === 0 ? find : { ...find, at: (find.at + by + count) % count };
}

function FindInBook({
  find,
  onFind,
}: {
  readonly find: BookFind | null;
  readonly onFind: (find: BookFind | null) => void;
}): ReactElement | null {
  if (find === null) return null;

  const count = find.matches.length;

  return (
    <FindBar
      query={find.query}
      count={
        count === 0 ? "No matches" : `${find.at + 1} of ${count}${count === maxMatches ? "+" : ""}`
      }
      hasMatches={count > 0}
      onStep={(by) => onFind(stepped(find, by))}
      onClose={() => onFind(null)}
    />
  );
}

function ReaderMessage({ message }: { readonly message: string | null }): ReactElement | null {
  if (message === null) return null;

  return (
    <p className="notice warn absolute inset-x-3 bottom-[calc(8rem+var(--safe-bottom))] z-40 md:mx-auto md:max-w-xl">
      {message}
    </p>
  );
}

// The panels that dock beside the page on a desktop. The More menu is a popover.
function docksBeside(panel: OpenPanel): boolean {
  return panel.kind !== "none" && panel.kind !== "more";
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

  // A book's first open shows the bars, so a new reader sees the tools. They go on the first page turn.
  const isFirstOpen = glance?.progress === null;
  const [showChrome, setChrome] = useState(isFirstOpen);
  const firstTurnHides = useRef(isFirstOpen);
  const [panel, setPanel] = useState<OpenPanel>(noPanel);
  const [prefChanges, setPrefChanges] = useState<Partial<BookPrefs>>({});
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [find, setFind] = useState<BookFind | null>(null);
  const [pageQuery, setPageQuery] = useState<string | null>(null);
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
    startOver,
    addName,
    editName,
  } = useSummary(bookId);
  // A tap of Summarise also writes the earlier books' summary after this one's, as Automatic summary does.
  const wantsSeries = useRef(false);

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

  const isSearching = find !== null || pageQuery !== null;

  useReaderKeys({
    isEnabled: panel.kind === "none",
    isSearchOpen: isSearching,
    setSearchOpen: () => {
      setFind(null);
      setPageQuery(null);
    },
    setTocOpen: () => setPanel({ kind: "contents", tab: "chapters" }),
    navigate,
    fontSize: bookSettings.fontSize,
    lineHeight: bookSettings.lineHeight,
  });

  const { guessed, kind, isEpub } = useBookKind(data, prefs);
  const { chapterList, isFinished, cover, readingCover, summaryInput, autoSummaryInput, lines } =
    useSummaryView({ data, ai, summary, kind, position, furthest });

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
    if (!hasConsent(ai) || !(ai.autoSummary || wantsSeries.current) || seriesId === null) {
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

    const opening = seriesTarget.current === -1 && !wantsSeries.current;

    seriesTarget.current = target;
    wantsSeries.current = false;

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

  const savePrefs = (changes: Partial<BookPrefs>): void => {
    const next = { ...prefChanges, ...changes };

    setPrefChanges(next);
    // The whole visit's changes, so saves that land out of order lose none.
    void runApp(saveBookPrefs(bookId, next).pipe(Effect.ignore));
  };
  // A text choice saves to this book and goes global for new books. Theme and warmth are global for every book.
  const changeSettings = (patch: Partial<ReaderSettings>): void => {
    const isLook = patch.theme !== undefined || patch.temperature !== undefined;
    const changes = Schema.decodeUnknownOption(BookPrefs)(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    );

    if (!isLook && Option.isSome(changes)) savePrefs(changes.value);
    update(patch);
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
      // The first move away from the place a first open showed counts as its first page turn.
      if (firstTurnHides.current && blockIndex !== furthestRef.current) {
        firstTurnHides.current = false;
        setChrome(false);
      }

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
    setPageQuery(null);
    setFind(null);
    // The other view mounts at the place being read, not at the last Contents entry.
    setJump(null);
    savePrefs({ mode: mode === "reader" ? "original" : "reader" });
  };
  const toggleChrome = useCallback(() => setChrome((value) => !value), []);
  const hideChrome = useCallback(() => {
    firstTurnHides.current = false;
    setChrome(false);
  }, []);
  const closePanel = (): void => setPanel(noPanel);
  // Contents goes to the entry in the view showing. It never switches the view.
  const selectToc = (blockIndex: number): void => setJump({ index: blockIndex, nonce: Date.now() });
  const openSummary = (openAt: number | null): void => {
    reloadSeries();
    setPanel({ kind: "summary", openAt });
  };
  const startSummary = (allowed?: AiSettings): void => {
    const using = allowed ?? ai;

    if (using === null || summaryInput === null) return;

    wantsSeries.current = true;
    start(summaryInput, using);
  };
  const stopSummary = (): void => {
    stop();

    if (seriesId !== null) {
      forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.stop(`series:${seriesId}`)));
    }
  };

  const isDocked = docksBeside(panel);

  return (
    <div
      className={`reader relative h-(--app-height) overflow-hidden bg-(--page) text-(--page-ink) ${isDocked ? "is-docked" : ""}`}
    >
      <div className="reader-shift">
        <div className="h-full">
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
              find={matchOf(find)}
              pageQuery={pageQuery}
              onCloseSearch={() => setPageQuery(null)}
              onToggleChrome={toggleChrome}
              onPageTurn={hideChrome}
            />
          )}
        </div>

        <ReaderBars
          title={title}
          isShown={showChrome && !isSearching}
          percent={percentLabel}
          ratio={shown / total}
          onPanel={(next: ReaderPanel) => {
            if (next === "contents") setPanel({ kind: "contents", tab: "chapters" });
            if (next === "summary") openSummary(null);
            if (next === "look") setPanel({ kind: "look", view: "look" });
            if (next === "more") setPanel({ kind: "more" });
          }}
        />

        <FindInBook find={find} onFind={setFind} />

        <ReaderMessage message={message} />
      </div>

      {panel.kind === "contents" && data !== null && (
        <ContentsPanel
          toc={toc}
          blocks={data.parsed.blocks}
          position={position}
          lines={lines}
          canSearch={data.meta.parseState !== "scanned"}
          isOriginal={showsPages}
          initialTab={panel.tab}
          onSelect={selectToc}
          onLine={(blockIndex) => {
            const index = chapterList.findIndex((chapter) => chapter.start === blockIndex);

            openSummary(index === -1 ? null : index);
          }}
          onFind={(query, matches, at) => {
            setChrome(false);
            setFind({ query, matches, at });
          }}
          onPageSearch={(query) => {
            setChrome(false);
            setPageQuery(query);
          }}
          onClose={closePanel}
        />
      )}

      {panel.kind === "look" && (
        <LookPanel
          settings={bookSettings}
          view={panel.view}
          onView={(view) => setPanel({ kind: "look", view })}
          onChange={changeSettings}
          onClose={closePanel}
        />
      )}

      {panel.kind === "more" && (
        <MorePanel
          mode={mode}
          isEpub={isEpub}
          onToggleMode={toggleMode}
          onDetails={() => {
            sheetRequest.bookId = bookId;
            slideTo(navigate, "/", "out");
          }}
          onClose={closePanel}
        />
      )}

      {panel.kind === "summary" && summaryInput !== null && (
        <SummaryPanel
          input={summaryInput}
          list={chapterList}
          cover={cover}
          ai={ai}
          font={bookSettings.font}
          state={{ summary, run, error: summaryError }}
          series={series}
          seriesJob={seriesJob}
          bookId={bookId}
          openAt={panel.openAt}
          onKind={(next) => savePrefs({ kind: next })}
          onStart={startSummary}
          onStop={stopSummary}
          onStartOver={() => {
            if (hasConsent(ai) && summaryInput !== null) startOver(summaryInput, ai);
            else discard();
          }}
          onSetup={(next) => {
            putAi(next);
            startSummary(next);
          }}
          onConsent={() => {
            if (ai === null) return null;

            const allowed = new AiSettings({
              ...ai,
              consentedAt: Date.now(),
              consentVersion: CONSENT_VERSION,
            });

            putAi(allowed);

            return allowed;
          }}
          onAddName={addName}
          onEditName={editName}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
