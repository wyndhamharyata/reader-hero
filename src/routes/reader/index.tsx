import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { forkApp, runApp, stopFiber, useAppEffect, useFigureJobs, useSettings } from "@/lib/hooks";
import { BookPrefs, ReaderSettings, type ReaderMode } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { guessMode } from "@/lib/guess-mode";
import { releaseWakeLock, requestWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { reparseBook, watchParsedBook } from "@/use-cases/parse-book";
import { saveReadingProgress } from "@/use-cases/save-progress";
import { MenuSheet } from "./_MenuSheet";
import { LoadError } from "./_LoadError";
import { ReaderBody } from "./_ReaderBody";
import type { JumpRequest } from "./_ReaderView";
import { ArrowLeftIcon, Bars3Icon } from "@/components/icons";

export function ReaderRoute() {
  const { id } = useParams();
  const bookId = id ?? "";
  const { settings, update } = useSettings();

  const { state, reload } = useAppEffect(
    Effect.gen(function* () {
      const store = yield* BookStore;
      const meta = yield* store.get(bookId);
      const parsed = yield* store.getParsed(bookId);
      const progress = yield* store.getProgress(bookId);
      const prefs = yield* store
        .getPrefs(bookId)
        .pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null)));
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
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const saveTimer = useRef<number | null>(null);

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
  useFigureJobs(pendingBooks);

  // The book's saved choices, with this visit's changes on top until a reload reads them back.
  const prefs: Partial<BookPrefs> = { ...data?.prefs, ...prefChanges };
  const bookSettings = new ReaderSettings({
    ...settings,
    theme: prefs.theme ?? settings.theme,
    font: prefs.font ?? settings.font,
    fontSize: prefs.fontSize ?? settings.fontSize,
    lineHeight: prefs.lineHeight ?? settings.lineHeight,
    textAlign: prefs.textAlign ?? settings.textAlign,
    textWidth: prefs.textWidth ?? settings.textWidth,
  });
  const guessed = useMemo(
    () => (data === null ? "reader" : guessMode(data.meta, data.parsed)),
    [data],
  );
  const mode: ReaderMode = prefs.mode ?? guessed;

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
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<BookPrefs>;
    savePrefs(changes);
    update(patch);
  };

  const loadError = state.status === "error" ? state.error : null;
  const title = data?.meta.title ?? "Reader";
  const toc = data?.parsed.toc ?? [];
  const total = data === null ? 1 : Math.max(1, data.parsed.blocks.length - 1);
  const percentLabel = formatPercent(position / total);

  const onPosition = (blockIndex: number) => {
    setPosition(blockIndex);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void runApp(saveReadingProgress(bookId, blockIndex, total));
    }, 400);
  };

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
  const toggleChrome = () => setChrome((value) => !value);
  const closeToc = () => setTocOpen(false);
  const selectToc = (blockIndex: number) => {
    setTocOpen(false);
    if (mode !== "reader") savePrefs({ mode: "reader" });
    setJump({ index: blockIndex, nonce: Date.now() });
  };

  const modeLabel = mode === "reader" ? "Original view" : "Reader view";
  const barClass = `absolute inset-x-0 bottom-0 z-30 flex flex-col-reverse gap-1 border-t border-base-300 bg-base-100 px-2 pt-2 pb-[calc(var(--safe-bottom)+0.25rem)] transition-transform md:top-0 md:bottom-auto md:flex-col md:border-t-0 md:border-b md:pt-[calc(var(--safe-top)+1.25rem)] md:pb-2 ${chrome ? "" : "translate-y-full md:-translate-y-full"}`;
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

      <nav className={barClass}>
        <div className="flex items-center gap-1">
          <Link to="/" className="btn btn-square btn-ghost md:btn-sm" aria-label="Back to library">
            <ArrowLeftIcon />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
          <button
            type="button"
            className="btn btn-square btn-ghost md:btn-sm"
            aria-label="Menu"
            onClick={() => setTocOpen(true)}
          >
            <Bars3Icon />
          </button>
        </div>
        <div className="flex items-center gap-3 px-2 md:px-0">
          <span className="w-10 text-xs opacity-70">{percentLabel}</span>
          <progress
            className="progress h-1.5 flex-1 progress-primary"
            value={position}
            max={total}
          />
        </div>
      </nav>

      {message !== null && (
        <div className="absolute inset-x-0 bottom-[calc(6rem+var(--safe-bottom))] z-40 px-3 md:bottom-[calc(4rem+var(--safe-bottom))]">
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
        onSelect={selectToc}
        onToggleMode={toggleMode}
        onSettingsChange={changeSettings}
        onClose={closeToc}
      />
    </div>
  );
}
