import { Effect, Stream } from "effect";
import { useEffect, useRef, useState } from "react";
import { ListBulletIcon, Squares2x2Icon } from "@/components/icons";
import { forkApp, runApp, stopFiber, useAppEffect, useFigureJobs, useSettings } from "@/lib/hooks";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { BookStore } from "@/services/book-store";
import { ensureCovers } from "@/use-cases/book-image";
import type { ParseProgress } from "@/use-cases/extract";
import { importPdfs } from "@/use-cases/import-pdfs";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";
import { BookCard } from "./_BookCard";
import { BusyOverlay } from "./_BusyOverlay";
import { InstallHint } from "./_InstallHint";
import { LibraryStatus } from "./_LibraryStatus";
import { OfflineBadge } from "./_OfflineBadge";
import { StorageUsage } from "./_StorageUsage";

const showInstallHint = isIosBrowser && !isInstalled;

export function LibraryRoute() {
  const { state, reload } = useAppEffect(
    Effect.gen(function* () {
      const store = yield* BookStore;
      const books = yield* store.list();
      const estimate = yield* store.estimate();
      return { books, estimate };
    }),
    [],
  );

  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;
  useFigureJobs(books);
  const grid = settings.libraryView === "grid";
  // Keyed on the ids, so the frequent meta reloads during parsing do not restart the cover job.
  const bookIds = books.map((book) => book.id).join(" ");

  useEffect(() => {
    if (bookIds === "") return;
    const fiber = forkApp(ensureCovers(bookIds.split(" ")));
    return () => stopFiber(fiber);
  }, [bookIds]);

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
          Stream.filter((update) => update.kind === "meta"),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [reload]);

  const importFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    const settle = Effect.sync(() => {
      setBusy(false);
      setProgress(null);
    });
    const program = importPdfs(files, setProgress, setMessage).pipe(
      Effect.ensuring(settle),
      Effect.tap(() => Effect.sync(() => reload())),
    );
    void runApp(program);
  };

  const remove = (id: string) => {
    void runApp(removeBook(id).pipe(Effect.tap(() => Effect.sync(() => reload()))));
  };

  const reparse = (id: string) => {
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

  const actionLabel = busy ? "Working…" : "Add PDF";

  const viewToggle = (
    <div className="join">
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${grid ? "btn-ghost" : "btn-active"}`}
        aria-label="List view"
        aria-pressed={!grid}
        onClick={() => update({ libraryView: "list" })}
      >
        <ListBulletIcon className="size-5 md:size-4" />
      </button>
      <button
        type="button"
        className={`btn join-item btn-square md:btn-sm ${grid ? "btn-active" : "btn-ghost"}`}
        aria-label="Grid view"
        aria-pressed={grid}
        onClick={() => update({ libraryView: "grid" })}
      >
        <Squares2x2Icon className="size-5 md:size-4" />
      </button>
    </div>
  );

  return (
    <main className="mx-auto flex min-h-[var(--app-height)] w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] pb-28">
      <header className="flex items-center justify-between gap-3 pt-2">
        <h1 className="text-2xl font-bold">Reader Hero</h1>
        <div className="flex items-center gap-2">
          <OfflineBadge />
          <div className="hidden md:block">{viewToggle}</div>
        </div>
      </header>

      {message !== null && (
        <div className="alert alert-warning">
          <span>{message}</span>
        </div>
      )}

      <InstallHint show={showInstallHint} />

      <LibraryStatus
        loading={state.status === "loading"}
        failed={state.status === "error"}
        books={books}
      />

      <ul
        className={grid ? "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3" : "flex flex-col gap-3"}
      >
        {books.map((book) => (
          <BookCard key={book.id} book={book} grid={grid} onRemove={remove} onReparse={reparse} />
        ))}
      </ul>

      <StorageUsage estimate={estimate} />

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-base-300 bg-base-100 px-4 pt-2 pb-[calc(var(--safe-bottom)+0.5rem)] md:inset-x-auto md:bottom-[max(1.5rem,var(--safe-bottom))] md:left-1/2 md:-translate-x-1/2 md:border-0 md:bg-transparent md:p-0">
        <div className="md:hidden">{viewToggle}</div>
        <button
          type="button"
          className="btn flex-1 btn-primary md:flex-none md:shadow-lg"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {actionLabel}
        </button>
      </div>

      {busy && <BusyOverlay progress={progress} />}
    </main>
  );
}
