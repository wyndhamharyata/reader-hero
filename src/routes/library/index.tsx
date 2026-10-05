import { Effect, Stream } from "effect";
import { useEffect, useRef, useState } from "react";
import { describeCause } from "@/lib/describe-error";
import { formatSize } from "@/lib/format";
import { forkApp, runApp, stopFiber, useAppEffect } from "@/lib/hooks";
import { isInstalled, isIosBrowser } from "@/lib/platform";
import { BookStore } from "@/services/book-store";
import type { ParseProgress } from "@/use-cases/extract";
import { addPdf } from "@/use-cases/import-book";
import { importInboxOnce } from "@/use-cases/import-inbox";
import { parseBook } from "@/use-cases/parse-book";
import { renderFigures } from "@/use-cases/render-figures";
import { BookCard } from "./_BookCard";
import { BusyOverlay } from "./_BusyOverlay";
import { InstallHint } from "./_InstallHint";

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

  useEffect(() => {
    void runApp(importInboxOnce()).then((count) => {
      if (count > 0) reload();
    });
  }, [reload]);

  useEffect(() => {
    const fiber = forkApp(
      Effect.gen(function* () {
        const store = yield* BookStore;
        yield* store.updates().pipe(
          Stream.filter((update) => update.imageId === null),
          Stream.runForEach(() => Effect.sync(() => reload())),
        );
      }),
    );
    return () => stopFiber(fiber);
  }, [reload]);

  useEffect(() => {
    if (state.status !== "done") return;
    for (const book of state.value.books) {
      if ((book.figures ?? "none") === "pending") forkApp(renderFigures(book.id));
    }
  }, [state]);

  const importFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    const program = Effect.forEach(files, (file) =>
      addPdf(file, setProgress).pipe(
        Effect.tap((meta) =>
          Effect.sync(() => {
            if ((meta.figures ?? "none") === "pending") forkApp(renderFigures(meta.id));
          }),
        ),
        Effect.catchCause((cause) => Effect.sync(() => setMessage(describeCause(cause, file.name)))),
      ),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          setBusy(false);
          setProgress(null);
        }),
      ),
      Effect.andThen(Effect.flatMap(BookStore, (store) => store.requestPersistent())),
      Effect.tap(() => Effect.sync(() => reload())),
    );
    void runApp(program);
  };

  const remove = (id: string) => {
    void runApp(Effect.flatMap(BookStore, (store) => store.remove(id))).then(() => reload());
  };

  const reparse = (id: string) => {
    setBusy(true);
    setMessage(null);
    const program = parseBook(id, setProgress).pipe(
      Effect.catchCause((cause) => Effect.sync(() => setMessage(describeCause(cause, "This book")))),
    );
    void runApp(program).then(() => {
      setBusy(false);
      setProgress(null);
      reload();
    });
  };

  const books = state.status === "done" ? state.value.books : [];
  const estimate = state.status === "done" ? state.value.estimate : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 pb-28">
      <header className="flex items-center justify-between gap-3 pt-2">
        <h1 className="text-2xl font-bold">Reader Hero</h1>
        <span className="badge badge-ghost badge-sm">offline</span>
      </header>

      {message !== null && (
        <div className="alert alert-warning">
          <span>{message}</span>
        </div>
      )}

      <InstallHint show={showInstallHint} />

      {state.status === "loading" && <p className="opacity-70">Loading library…</p>}

      {state.status === "error" && (
        <div className="alert alert-error">
          <span>Your library could not be loaded.</span>
        </div>
      )}

      {state.status === "done" && books.length === 0 && (
        <div className="rounded-box bg-base-200 p-8 text-center">
          <p className="text-lg font-medium">No books yet</p>
          <p className="mt-1 text-sm opacity-70">
            Add a PDF and read it in a clean, reflowed view.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onRemove={remove} onReparse={reparse} />
        ))}
      </ul>

      {estimate !== null && estimate.quota > 0 && (
        <p className="text-center text-xs opacity-60">
          Using {formatSize(estimate.usage)} of {formatSize(estimate.quota)}
        </p>
      )}

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
        className="btn btn-primary fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 shadow-lg"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {busy ? "Working…" : "Add PDF"}
      </button>

      {busy && <BusyOverlay progress={progress} />}
    </main>
  );
}
