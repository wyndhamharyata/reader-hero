import { Effect, Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
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
import { AiSettings } from "@/domain/ai";
import { BookPrefs, ReaderSettings, type ReaderMode } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { guessKind } from "@/lib/guess-kind";
import { guessMode } from "@/lib/guess-mode";
import { releaseWakeLock, requestWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { chapters } from "@/use-cases/ai-context";
import { reparseBook, watchParsedBook } from "@/use-cases/parse-book";
import { storedRecap, type RecapInput, type RecapScope } from "@/use-cases/recap";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { describeSummary, type SummaryInput } from "@/use-cases/summary";
import { MenuSheet } from "./_MenuSheet";
import { ReaderNav } from "./_ReaderNav";
import { LoadError } from "./_LoadError";
import { ReaderBody } from "./_ReaderBody";
import { ResultSheet } from "./_ResultSheet";
import { SummarySheet } from "./_SummarySheet";
import type { JumpRequest } from "./_ReaderView";

export function ReaderRoute() {
  const { id } = useParams();
  const bookId = id ?? "";
  const { settings, update } = useSettings();

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

  const [chrome, setChrome] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [prefChanges, setPrefChanges] = useState<Partial<BookPrefs>>({});
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const { ai, putAi } = useAiSettings();
  const [recap, setRecap] = useState<{ index: number; scope: RecapScope } | null>(null);
  const [recapAt, setRecapAt] = useState<number | null>(null);
  const { summary, run, error: summaryError, start, stop, discard, addName } = useSummary(bookId);
  const [summarySheet, setSummarySheet] = useState<{ openAt: number | null } | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<(() => void) | null>(null);
  const totalRef = useRef(1);

  useEffect(() => {
    const program = requestWakeLock().pipe(
      Effect.tap((sentinel) =>
        Effect.sync(() => {
          wakeRef.current = sentinel;
        }),
      ),
    );
    void runApp(program);
    return () => {
      releaseWakeLock(wakeRef.current);
    };
  }, []);

  useEffect(() => {
    const fiber = forkApp(watchParsedBook(bookId, () => reload()));
    return () => stopFiber(fiber);
  }, [bookId, reload]);

  const data = state.status === "done" ? state.value : null;
  const pendingBooks = useMemo(() => (data === null ? [] : [data.meta]), [data]);
  // The figure job starts at the page being read, so its figures land first.
  const startPage = data?.parsed.blocks[data.progress?.blockIndex ?? 0]?.page ?? 1;
  useFigureJobs(pendingBooks, startPage);

  // The book's saved choices, with this visit's changes on top until a reload reads them back.
  const prefs = useMemo<Partial<BookPrefs>>(
    () => ({ ...data?.prefs, ...prefChanges }),
    [data, prefChanges],
  );
  // Memoised so a position change does not hand the memoised reader view a new settings object.
  const bookSettings = useMemo(
    () =>
      new ReaderSettings({
        ...settings,
        theme: prefs.theme ?? settings.theme,
        font: prefs.font ?? settings.font,
        fontSize: prefs.fontSize ?? settings.fontSize,
        lineHeight: prefs.lineHeight ?? settings.lineHeight,
        textAlign: prefs.textAlign ?? settings.textAlign,
        textWidth: prefs.textWidth ?? settings.textWidth,
      }),
    [settings, prefs],
  );
  const guessed = useMemo(
    () => (data === null ? "reader" : guessMode(data.meta, data.parsed)),
    [data],
  );
  const guessedKind = useMemo(
    () => (data === null ? "story" : guessKind(data.meta, data.parsed)),
    [data],
  );
  const kind = prefs.kind ?? guessedKind;
  // An EPUB has no pages to show, so it always reads in reader mode.
  const epub = data?.meta.format === "epub";

  // The recap row says when the current pages already have a stored recap. The key is a hash of
  // the pages, so this is a local read and never a call.
  useEffect(() => {
    if (!tocOpen || data === null || ai === null) {
      setRecapAt(null);
      return;
    }
    const input: RecapInput = {
      meta: data.meta,
      parsed: data.parsed,
      kind,
      index: position,
      scope: "recent",
      summary: null,
    };
    const fiber = forkApp(
      storedRecap(input, ai).pipe(
        Effect.map((artifact) => setRecapAt(artifact?.createdAt ?? null)),
        Effect.ignore,
      ),
    );
    return () => stopFiber(fiber);
  }, [tocOpen, data, ai, kind, position]);

  // Only the Read so far scope reads the summary, so a chapter that lands mid-recap restarts nothing else.
  const sofarSummary = recap?.scope === "sofar" ? summary : null;
  const recapInput = useMemo<RecapInput | null>(
    () =>
      data === null || recap === null
        ? null
        : {
            meta: data.meta,
            parsed: data.parsed,
            kind,
            index: recap.index,
            scope: recap.scope,
            summary: sofarSummary,
          },
    [data, recap, kind, sofarSummary],
  );

  // The summary covers the chapters before the position for a story, and every section otherwise.
  const chapterList = useMemo(() => (data === null ? [] : chapters(data.parsed)), [data]);
  const before = useMemo(
    () => chapterList.filter((chapter) => chapter.end <= position).length,
    [chapterList, position],
  );
  const target = kind === "story" ? before : chapterList.length;
  const summaryInput = useMemo<SummaryInput | null>(
    () => (data === null ? null : { meta: data.meta, parsed: data.parsed, kind, target }),
    [data, kind, target],
  );
  const summaryText = describeSummary(summary, target, run, kind);
  const behind = before - Math.min(summary?.chapters.length ?? 0, before);
  const lines = useMemo(() => {
    const map = new Map<number, string>();
    if (ai === null || !ai.linesInContents || summary === null) return map;
    chapterList.forEach((chapter, index) => {
      const stored = summary.chapters[index];
      // A re-parse can change the chapters; a line shows only under the heading it was made for.
      if (stored !== undefined && stored.heading === chapter.heading) {
        map.set(chapter.start, stored.line);
      }
    });
    return map;
  }, [ai, summary, chapterList]);

  // With the switch on, each chapter is summarised as soon as it is read, with no tap. An error
  // waits for a tap in the sheet, so a failing provider is not asked again and again.
  useEffect(() => {
    if (ai === null || !ai.autoSummary || ai.consentedAt === undefined || summaryInput === null) {
      return;
    }
    if (run !== null || summaryError !== null || !navigator.onLine) return;
    if ((summary?.chapters.length ?? 0) >= target) return;
    start(summaryInput, ai);
  }, [ai, summaryInput, run, summaryError, summary, target, start]);

  // A PDF may switch to the original view, so its page renderer loads its scripts now.
  useEffect(() => {
    if (data === null || epub) return;
    void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
  }, [data, epub]);
  const mode: ReaderMode = epub ? "reader" : (prefs.mode ?? guessed);

  // Runs after useSettings applies the global theme, so this book's own theme wins while it is open.
  useEffect(() => {
    document.documentElement.dataset.theme = bookSettings.theme;
  }, [bookSettings.theme, settings.theme]);

  const savePrefs = (changes: Partial<BookPrefs>): void => {
    const next = { ...prefChanges, ...changes };
    setPrefChanges(next);
    const saved = new BookPrefs({ ...data?.prefs, ...next });
    void runApp(
      Effect.flatMap(BookStore, (store) => store.putPrefs(bookId, saved)).pipe(Effect.ignore),
    );
  };
  // A change saves to this book and to the global settings, so new books start from it.
  const changeSettings = (patch: Partial<ReaderSettings>): void => {
    const changes = Schema.decodeUnknownOption(BookPrefs)(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    );
    if (Option.isSome(changes)) savePrefs(changes.value);
    update(patch);
  };

  const loadError = state.status === "error" ? state.error : null;
  const title = data?.meta.title ?? "Reader";
  const toc = data?.parsed.toc ?? [];
  const total = data === null ? 1 : Math.max(1, data.parsed.blocks.length - 1);
  const percentLabel = formatPercent(position / total);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  // Stable, or every position change rebuilds the reader's observer over every block.
  const onPosition = useCallback(
    (blockIndex: number) => {
      setPosition(blockIndex);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      const save = (): void => {
        pendingSave.current = null;
        saveTimer.current = null;
        void runApp(saveReadingProgress(bookId, blockIndex, totalRef.current));
      };
      pendingSave.current = save;
      saveTimer.current = window.setTimeout(save, 400);
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

  const rebuild = () => {
    setRebuilding(true);
    setMessage(null);
    const program = reparseBook(bookId, () => {}, setMessage).pipe(
      Effect.ensuring(Effect.sync(() => setRebuilding(false))),
      Effect.tap(() => Effect.sync(() => reload())),
    );
    void runApp(program);
  };

  const toggleMode = (): void => savePrefs({ mode: mode === "reader" ? "original" : "reader" });
  const toggleChrome = useCallback(() => setChrome((value) => !value), []);
  const closeToc = () => setTocOpen(false);
  const selectToc = (blockIndex: number) => {
    setTocOpen(false);
    if (mode !== "reader") savePrefs({ mode: "reader" });
    setJump({ index: blockIndex, nonce: Date.now() });
  };

  const modeLabel = mode === "reader" ? "Original view" : "Reader view";
  const contentClass = chrome
    ? "h-full pt-[var(--safe-top)] md:pt-[calc(5.5rem+var(--safe-top))]"
    : "h-full pt-[var(--safe-top)]";

  return (
    <div className="relative h-[var(--app-height)] bg-base-100">
      <div className={contentClass}>
        {state.status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        )}

        {loadError !== null && (
          <LoadError error={loadError} title={title} rebuilding={rebuilding} onRebuild={rebuild} />
        )}

        {data !== null && (
          <ReaderBody
            meta={data.meta}
            parsed={data.parsed}
            progress={data.progress}
            position={position}
            onPosition={onPosition}
            mode={mode}
            chrome={chrome}
            settings={bookSettings}
            jump={jump}
            onToggleChrome={toggleChrome}
          />
        )}
      </div>

      <ReaderNav
        title={title}
        chrome={chrome}
        percentLabel={percentLabel}
        position={position}
        total={total}
        onMenu={() => setTocOpen(true)}
      />

      {message !== null && (
        <div className="absolute inset-x-0 bottom-[calc(7.5rem+var(--safe-bottom))] z-40 px-3 md:bottom-[calc(4rem+var(--safe-bottom))]">
          <div className="alert py-2 text-sm alert-warning">
            <span>{message}</span>
          </div>
        </div>
      )}

      <MenuSheet
        open={tocOpen}
        toc={toc}
        modeLabel={modeLabel}
        settings={bookSettings}
        ai={{
          settings: ai,
          kind,
          guessed: prefs.kind === undefined,
          recapAt,
          summary: summaryText.row,
          summaryRunning: run !== null,
          onKind: (next) => savePrefs({ kind: next }),
          onRecap: () => setRecap({ index: position, scope: "recent" }),
          onSummary: () => setSummarySheet({ openAt: null }),
          onStopSummary: stop,
        }}
        lines={lines}
        onSelect={selectToc}
        onLine={(blockIndex) => {
          const index = chapterList.findIndex((chapter) => chapter.start === blockIndex);
          setSummarySheet({ openAt: index === -1 ? null : index });
        }}
        onToggleMode={epub ? undefined : toggleMode}
        onSettingsChange={changeSettings}
        onClose={closeToc}
      />

      {recapInput !== null && ai !== null && (
        <ResultSheet
          input={recapInput}
          settings={ai}
          behind={behind}
          summary={{ row: summaryText.row, action: summaryText.action, running: run !== null }}
          onSummarise={() => {
            if (summaryInput !== null) start(summaryInput, ai);
          }}
          onScope={(scope) => setRecap({ index: recapInput.index, scope })}
          onConsent={() => putAi(new AiSettings({ ...ai, consentedAt: Date.now() }))}
          onClose={() => setRecap(null)}
        />
      )}

      {summarySheet !== null && summaryInput !== null && ai !== null && (
        <SummarySheet
          input={summaryInput}
          settings={ai}
          state={{ summary, run, error: summaryError }}
          openAt={summarySheet.openAt}
          onStart={() => start(summaryInput, ai)}
          onStop={stop}
          onDiscard={discard}
          onAddName={addName}
          onConsent={() => putAi(new AiSettings({ ...ai, consentedAt: Date.now() }))}
          onClose={() => setSummarySheet(null)}
        />
      )}
    </div>
  );
}
