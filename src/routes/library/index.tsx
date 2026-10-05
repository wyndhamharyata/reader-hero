import { Effect, Stream } from "effect";
import { useEffect, useRef, useState } from "react";
import { forkApp, runApp, stopFiber, useAppEffect, useFigureJobs } from "@/lib/hooks";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { BookStore } from "@/services/book-store";
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

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;
  useFigureJobs(books);

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
    void runApp(
      removeBook(id).pipe(Effect.tap(() => Effect.sync(() => reload()))),
    );
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

  return (
    <main className="mx-auto flex min-h-[var(--app-height)] w-full max-w-2xl flex-col gap-4 p-4 pt-[calc(var(--safe-top)+1.25rem)] pb-28">
      <header className="flex items-center justify-between gap-3 pt-2">
        <h1 className="text-2xl font-bold">Reader Hero</h1>
        <OfflineBadge />
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

      <ul className="flex flex-col gap-3">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onRemove={remove} onReparse={reparse} />
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

      <button
        type="button"
        className="btn btn-primary fixed bottom-[max(1.5rem,var(--safe-bottom))] left-1/2 z-40 -translate-x-1/2 shadow-lg"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {actionLabel}
      </button>

      {busy && <BusyOverlay progress={progress} />}
    </main>
  );
}
