import { Effect, Stream } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ReadingProgress } from "@/domain/book";
import { describeCause, describeError } from "@/lib/describe-error";
import { formatPercent } from "@/lib/format";
import { forkApp, runApp, stopFiber, useAppEffect, useSettings } from "@/lib/hooks";
import { releaseWakeLock, requestWakeLock } from "@/lib/wake-lock";
import { BookStore } from "@/services/book-store";
import { parseBook } from "@/use-cases/parse-book";
import { renderFigures } from "@/use-cases/render-figures";
import { OriginalView } from "./_OriginalView";
import { ReaderView, type JumpRequest } from "./_ReaderView";
import { SettingsSheet } from "./_SettingsSheet";
import { TocDrawer } from "./_TocDrawer";

type Mode = "reader" | "original";

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
  const [position, setPosition] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    void runApp(requestWakeLock()).then((sentinel) => {
      wakeRef.current = sentinel;
    });
    return () => {
      releaseWakeLock(wakeRef.current);
    };
  }, []);

  const data = state.status === "done" ? state.value : null;
  const parsed = data?.parsed ?? null;

  useEffect(() => {
    if (initialized.current) return;
    if (data !== null && data.meta.parseState === "scanned") {
      setMode("original");
      initialized.current = true;
    }
  }, [data]);

  useEffect(() => {
    if (data !== null && (data.meta.figures ?? "none") === "pending") {
      forkApp(renderFigures(bookId));
    }
  }, [data, bookId]);

  useEffect(() => {
    const fiber = forkApp(
      Effect.gen(function* () {
        const store = yield* BookStore;
        yield* store.updates().pipe(
          Stream.filter((update) => update.kind === "parsed" && update.bookId === bookId),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [bookId, reload]);

  const onPosition = useCallback(
    (blockIndex: number) => {
      setPosition(blockIndex);
      const total = parsed === null ? 1 : Math.max(1, parsed.blocks.length - 1);
      const percent = blockIndex / total;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void runApp(
          Effect.flatMap(BookStore, (store) =>
            store.putProgress(
              bookId,
              new ReadingProgress({ blockIndex, percent, updatedAt: Date.now() }),
            ),
          ),
        );
      }, 400);
    },
    [bookId, parsed],
  );

  const onOriginalPage = useCallback(
    (page: number) => {
      if (parsed === null) return;
      const index = parsed.blocks.findIndex((block) => block.page >= page);
      if (index >= 0) onPosition(index);
    },
    [parsed, onPosition],
  );

  const rebuild = () => {
    setRebuilding(true);
    setMessage(null);
    const program = parseBook(bookId, () => {}).pipe(
      Effect.catchCause((cause) => Effect.sync(() => setMessage(describeCause(cause, "This book")))),
    );
    void runApp(program).then(() => {
      setRebuilding(false);
      forkApp(renderFigures(bookId));
      reload();
    });
  };

  const toggleMode = () => setMode(mode === "reader" ? "original" : "reader");
  const openToc = () => setTocOpen(true);
  const closeToc = () => setTocOpen(false);
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);
  const toggleChrome = () => setChrome((value) => !value);

  const selectToc = (blockIndex: number) => {
    setTocOpen(false);
    setMode("reader");
    setJump({ index: blockIndex, nonce: Date.now() });
  };

  const title = data?.meta.title ?? "Reader";
  const total = parsed === null ? 1 : Math.max(1, parsed.blocks.length - 1);
  const percentLabel = parsed === null ? "" : formatPercent(position / total);
  const currentPage = parsed?.blocks[position]?.page ?? 1;
  const modeLabel = mode === "reader" ? "Original" : "Reader";
  const initialBlock = data?.progress?.blockIndex ?? 0;
  const headerClass = `fixed inset-x-0 top-0 z-30 flex items-center gap-1 border-b border-base-300 bg-base-100/95 px-2 py-2 backdrop-blur transition-transform ${chrome ? "" : "-translate-y-full"}`;
  const footerClass = `fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/95 px-4 py-2 backdrop-blur transition-transform ${chrome ? "" : "translate-y-full"}`;
  const loadError = state.status === "error" ? state.error : null;
  const canRebuild = loadError !== null && loadError._tag === "ParsedMissing";

  return (
    <div className="h-dvh bg-base-100">
      <header className={headerClass}>
        <Link to="/" className="btn btn-ghost btn-sm" aria-label="Back to library">
          Back
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openToc}>
          Contents
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleMode}>
          {modeLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openSettings}>
          Aa
        </button>
      </header>

      <div className="h-full pt-12 pb-14">
        {state.status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        )}

        {loadError !== null && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="opacity-80">{describeError(loadError, title)}</p>
            {canRebuild && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={rebuild}
                disabled={rebuilding}
              >
                Rebuild reader view
              </button>
            )}
            <Link to="/" className="btn btn-ghost btn-sm">
              Back to library
            </Link>
          </div>
        )}

        {data !== null && mode === "reader" && parsed !== null && (
          <ReaderView
            bookId={bookId}
            parsed={parsed}
            settings={settings}
            initialBlock={initialBlock}
            jump={jump}
            onPosition={onPosition}
            onToggleChrome={toggleChrome}
          />
        )}

        {data !== null && mode === "original" && (
          <OriginalView
            bookId={bookId}
            pageCount={data.meta.pageCount}
            initialPage={currentPage}
            onPageChange={onOriginalPage}
          />
        )}

        {data !== null && data.meta.parseState === "scanned" && mode === "reader" && (
          <div className="fixed inset-x-0 top-16 z-20 px-3">
            <div className="alert alert-warning py-2 text-xs">
              <span>No text layer found. Showing the original pages.</span>
            </div>
          </div>
        )}
      </div>

      <footer className={footerClass}>
        <div className="flex items-center gap-3">
          <span className="w-10 text-xs opacity-70">{percentLabel}</span>
          <progress
            className="progress progress-primary h-1.5 flex-1"
            value={position}
            max={total}
          />
        </div>
      </footer>

      {message !== null && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-3">
          <div className="alert alert-warning py-2 text-sm">
            <span>{message}</span>
          </div>
        </div>
      )}

      <TocDrawer open={tocOpen} toc={parsed?.toc ?? []} onSelect={selectToc} onClose={closeToc} />
      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        onChange={update}
        onClose={closeSettings}
      />
    </div>
  );
}
