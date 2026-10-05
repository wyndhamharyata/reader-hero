import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { forkApp, runApp, stopFiber, useAppEffect, useFigureJobs, useSettings } from "@/lib/hooks";
import { releaseWakeLock, requestWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { reparseBook, watchParsedBook } from "@/use-cases/parse-book";
import { HeaderMenu } from "./_Menu";
import { LoadError } from "./_LoadError";
import { ReaderBody, type Mode } from "./_ReaderBody";
import { SettingsSheet } from "./_SettingsSheet";
import { TocDrawer } from "./_TocDrawer";
import type { JumpRequest } from "./_ReaderView";
import { ArrowLeftIcon } from "./_icons";

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
      return { meta, parsed, progress };
    }),
    [bookId],
  );

  const [chrome, setChrome] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("reader");
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

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

  const loadError = state.status === "error" ? state.error : null;
  const title = data?.meta.title ?? "Reader";
  const toc = data?.parsed.toc ?? [];

  const rebuild = () => {
    setRebuilding(true);
    setMessage(null);
    const program = reparseBook(bookId, () => {}, setMessage).pipe(
      Effect.ensuring(Effect.sync(() => setRebuilding(false))),
      Effect.tap(() => Effect.sync(() => reload())),
    );
    void runApp(program);
  };

  const toggleMode = () => setMode(mode === "reader" ? "original" : "reader");
  const toggleChrome = () => setChrome((value) => !value);
  const openToc = () => setTocOpen(true);
  const closeToc = () => setTocOpen(false);
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);
  const selectToc = (blockIndex: number) => {
    setTocOpen(false);
    setMode("reader");
    setJump({ index: blockIndex, nonce: Date.now() });
  };

  const modeLabel = mode === "reader" ? "Original view" : "Reader view";
  const headerClass = `fixed inset-x-0 top-0 z-30 flex items-center gap-1 border-b border-base-300 bg-base-100/95 px-2 py-2 backdrop-blur transition-transform ${chrome ? "" : "-translate-y-full"}`;
  const contentClass = chrome ? "h-full pt-12 pb-14" : "h-full";

  return (
    <div className="h-dvh bg-base-100">
      <header className={headerClass}>
        <Link to="/" className="btn btn-ghost btn-sm btn-square" aria-label="Back to library">
          <ArrowLeftIcon />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <HeaderMenu
          modeLabel={modeLabel}
          onContents={openToc}
          onToggleMode={toggleMode}
          onSettings={openSettings}
        />
      </header>

      <div className={contentClass}>
        {state.status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        )}

        {loadError !== null && (
          <LoadError
            error={loadError}
            title={title}
            rebuilding={rebuilding}
            onRebuild={rebuild}
          />
        )}

        {data !== null && (
          <ReaderBody
            meta={data.meta}
            parsed={data.parsed}
            progress={data.progress}
            mode={mode}
            chrome={chrome}
            settings={settings}
            jump={jump}
            onToggleChrome={toggleChrome}
          />
        )}
      </div>

      {message !== null && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-3">
          <div className="alert alert-warning py-2 text-sm">
            <span>{message}</span>
          </div>
        </div>
      )}

      <TocDrawer open={tocOpen} toc={toc} onSelect={selectToc} onClose={closeToc} />
      <SettingsSheet open={settingsOpen} settings={settings} onChange={update} onClose={closeSettings} />
    </div>
  );
}
