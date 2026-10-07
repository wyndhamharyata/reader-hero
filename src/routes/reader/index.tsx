import { Effect, Option, Schema } from "effect";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { AiSettings } from "@/domain/ai";
import { BookPrefs, ReaderSettings, type ReaderMode } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { guessKind } from "@/lib/guess-kind";
import { guessMode } from "@/lib/guess-mode";
import { slideBack } from "@/lib/slide-to";
import { releaseWakeLock, requestWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { PageRenderer } from "@/services/page-renderer";
import { chapters } from "@/use-cases/ai-context";
import { reparseBook, watchParsedBook } from "@/use-cases/parse-book";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { coverage, describeSummary, type SummaryInput } from "@/use-cases/summary";
import { MenuSheet } from "./_MenuSheet";
import { ReaderNav } from "./_ReaderNav";
import { LoadError } from "./_LoadError";
import { ReaderBody } from "./_ReaderBody";
import { SummarySheet } from "./_SummarySheet";
import type { JumpRequest } from "./_ReaderView";

// While `preparing` it renders hidden under the library, so it slides in with its first screen done.
export function ReaderRoute({ bookId, preparing }: { bookId: string; preparing: boolean }) {
  const navigate = useNavigate();
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
  // The summary follows the furthest block, so going back over earlier pages asks for nothing.
  const [furthest, setFurthest] = useState(0);
  const furthestRef = useRef(0);
  const { ai, putAi } = useAiSettings();
  const {
    summary,
    run,
    error: summaryError,
    start,
    stop,
    discard,
    addName,
    editName,
  } = useSummary(bookId);
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
  useEffect(() => {
    const stored = data?.progress;
    if (stored === undefined || stored === null) return;
    furthestRef.current = Math.max(furthestRef.current, stored.furthest ?? stored.blockIndex);
    setFurthest(furthestRef.current);
  }, [data]);
  const pendingBooks = useMemo(() => (data === null ? [] : [data.meta]), [data]);
  // The figure job starts at the page being read, so its figures land first.
  const startPage = data?.parsed.blocks[data.progress?.blockIndex ?? 0]?.page ?? 1;
  // Held while preparing, so the figure job does not slow the open it waits on.
  useFigureJobs(preparing ? [] : pendingBooks, startPage);

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
        temperature: prefs.temperature ?? settings.temperature,
      }),
    [settings, prefs],
  );
  // Off while a sheet is open, as each sheet takes its own Escape; moves are smooth so the eye can follow.
  useEffect(() => {
    if (preparing || tocOpen || summarySheet !== null) return;
    const line = bookSettings.fontSize * bookSettings.lineHeight;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    const scroller = (): HTMLElement | null => document.querySelector("[data-scroller]");
    let held: {
      key: string;
      direction: 1 | -1;
      since: number;
      last: number;
      frame: number;
    } | null = null;
    const stop = (): void => {
      if (held !== null) cancelAnimationFrame(held.frame);
      held = null;
    };
    // A clock of its own, not key repeat, which starts late and moves in steps.
    const run = (now: number): void => {
      if (held === null) return;
      const seconds = (now - held.last) / 1000;
      const heldFor = (now - held.since) / 1000;
      held.last = now;
      const target = scroller();
      if (heldFor > 0.12 && target !== null) {
        const speed = Math.min(36, 12 + (heldFor - 0.12) * 12) * line;
        target.scrollBy({ top: held.direction * speed * seconds });
      }
      held.frame = requestAnimationFrame(run);
    };
    const jump = (direction: 1 | -1, instant: boolean): void => {
      const target = scroller();
      if (target === null) return;
      const top = target.getBoundingClientRect().top + 16;
      const items = Array.from(target.querySelectorAll<HTMLElement>("[data-block], [data-page]"));
      const next =
        direction === 1
          ? items.find((item) => item.getBoundingClientRect().top > top + 2)
          : items.reverse().find((item) => item.getBoundingClientRect().top < top - 2);
      target.scrollBy({
        top:
          next === undefined
            ? (direction * target.clientHeight) / 2
            : next.getBoundingClientRect().top - top,
        behavior: instant ? "auto" : behavior,
      });
    };
    const scroll = (event: KeyboardEvent, direction: 1 | -1): void => {
      if (event.repeat) return;
      scroller()?.scrollBy({ top: direction * 2 * line, behavior });
      if (held !== null) return;
      const now = performance.now();
      held = {
        key: event.key,
        direction,
        since: now,
        last: now,
        frame: requestAnimationFrame(run),
      };
    };
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
      if (typing || event.metaKey || event.altKey) return;
      switch (event.key) {
        case "Escape":
          slideBack(navigate);
          break;
        case "ArrowDown":
        case "j":
          if (event.ctrlKey) return;
          scroll(event, 1);
          break;
        case "ArrowUp":
        case "k":
          if (event.ctrlKey) return;
          scroll(event, -1);
          break;
        case "d":
          if (!event.ctrlKey) return;
          jump(1, event.repeat);
          break;
        case "u":
          if (!event.ctrlKey) return;
          jump(-1, event.repeat);
          break;
        case "s":
          if (event.ctrlKey) return;
          setTocOpen(true);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (held !== null && event.key === held.key) stop();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
    };
  }, [preparing, tocOpen, summarySheet, navigate, bookSettings.fontSize, bookSettings.lineHeight]);

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

  const chapterList = useMemo(() => (data === null ? [] : chapters(data.parsed)), [data]);
  const summaryIndex = Math.max(position, furthest);
  const cover = useMemo(
    () =>
      data === null
        ? { target: 0, current: null }
        : coverage(chapterList, data.parsed, kind, summaryIndex),
    [data, chapterList, kind, summaryIndex],
  );
  const summaryInput = useMemo<SummaryInput | null>(
    () =>
      data === null ? null : { meta: data.meta, parsed: data.parsed, kind, index: summaryIndex },
    [data, kind, summaryIndex],
  );
  const summaryText = describeSummary(summary, cover, run, kind);
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

  // Once per finished chapter, so Stop and Discard hold until the reader finishes the next one.
  const autoTarget = useRef(-1);
  useEffect(() => {
    if (ai === null || !ai.autoSummary || ai.consentedAt === undefined || summaryInput === null) {
      return;
    }
    // An error waits for a tap in the sheet, so a failing provider is not asked again and again.
    if (run !== null || summaryError !== null || !navigator.onLine) return;
    if (cover.target <= autoTarget.current) return;
    autoTarget.current = cover.target;
    if ((summary?.chapters.length ?? 0) >= cover.target) return;
    start(summaryInput, ai);
  }, [ai, summaryInput, run, summaryError, summary, cover.target, start]);

  // A PDF may switch to the original view, so its page renderer loads its scripts once the book shows.
  useEffect(() => {
    if (data === null || epub || preparing) return;
    void runApp(Effect.flatMap(PageRenderer, (renderer) => renderer.warm()));
  }, [data, epub, preparing]);
  const mode: ReaderMode = epub ? "reader" : (prefs.mode ?? guessed);

  // Runs after useSettings applies the global theme, so this book's own theme wins while it is open.
  useLayoutEffect(() => {
    if (preparing) return;
    document.documentElement.dataset.theme = bookSettings.theme;
    document.documentElement.style.setProperty("--temperature", String(bookSettings.temperature));
  }, [
    preparing,
    bookSettings.theme,
    bookSettings.temperature,
    settings.theme,
    settings.temperature,
  ]);

  const savePrefs = (changes: Partial<BookPrefs>): void => {
    const next = { ...prefChanges, ...changes };
    setPrefChanges(next);
    const saved = new BookPrefs({ ...data?.prefs, ...next });
    void runApp(
      Effect.flatMap(BookStore, (store) => store.putPrefs(bookId, saved)).pipe(Effect.ignore),
    );
  };
  // Saves to this book; a text choice also goes global for new books, but Settings owns the theme.
  const changeSettings = (patch: Partial<ReaderSettings>): void => {
    const changes = Schema.decodeUnknownOption(BookPrefs)(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    );
    if (Option.isSome(changes)) savePrefs(changes.value);
    if (patch.theme === undefined && patch.temperature === undefined) update(patch);
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
    <div
      // Hidden and out of reach while preparing; `invisible` still lays it out, so it can place itself.
      className={`${preparing ? "invisible fixed inset-x-0 top-0" : "relative"} h-[var(--app-height)] bg-base-100`}
      inert={preparing}
      aria-hidden={preparing}
    >
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
        summary={summaryText.row}
        summaryRunning={run !== null}
        onSummary={() => setSummarySheet({ openAt: null })}
        onStopSummary={stop}
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

      {summarySheet !== null && summaryInput !== null && (
        <SummarySheet
          input={summaryInput}
          list={chapterList}
          cover={cover}
          settings={ai}
          reading={bookSettings}
          state={{ summary, run, error: summaryError }}
          onKind={(next) => savePrefs({ kind: next })}
          openAt={summarySheet.openAt}
          onStart={() => {
            if (ai !== null) start(summaryInput, ai);
          }}
          onStop={stop}
          onDiscard={discard}
          onAddName={addName}
          onEditName={editName}
          onConsent={() => {
            if (ai !== null) putAi(new AiSettings({ ...ai, consentedAt: Date.now() }));
          }}
          onClose={() => setSummarySheet(null)}
        />
      )}
    </div>
  );
}
