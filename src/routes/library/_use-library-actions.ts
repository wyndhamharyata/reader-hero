import { Effect } from "effect";
import { useRef, useState } from "react";
import { describeError } from "@/lib/describe-error";
import { forkApp, runApp, stopFiber, type Job } from "@/lib/hooks";
import type { ParseProgress } from "@/use-cases/extract";
import { importBooks } from "@/use-cases/import-books";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";

export function useLibraryActions(reload: () => void): {
  readonly busy: boolean;
  readonly importing: boolean;
  readonly progress: ParseProgress | null;
  readonly message: string | null;
  readonly setMessage: (message: string | null) => void;
  readonly importFiles: (
    files: ReadonlyArray<File>,
    then?: (ids: ReadonlyArray<string>) => void,
  ) => void;
  readonly cancelImport: () => void;
  readonly remove: (id: string) => void;
  readonly reparse: (id: string) => void;
} {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const importJob = useRef<Job | null>(null);

  const importFiles = (
    files: ReadonlyArray<File>,
    then?: (ids: ReadonlyArray<string>) => void,
  ): void => {
    if (files.length === 0) return;

    setBusy(true);
    setImporting(true);
    setMessage(null);

    // Runs on cancel too, so a cancelled file is removed without a meta update.
    const settle = Effect.sync(() => {
      setBusy(false);
      setImporting(false);
      setProgress(null);
      importJob.current = null;
      reload();
    });

    importJob.current = forkApp(
      importBooks(files, setProgress, setMessage).pipe(
        Effect.tap((ids) => Effect.sync(() => then?.(ids))),
        Effect.ensuring(settle),
      ),
    );
  };

  const cancelImport = (): void => {
    if (importJob.current !== null) stopFiber(importJob.current);
  };

  const remove = (id: string): void => {
    const program = removeBook(id).pipe(
      Effect.tap(() => Effect.sync(() => reload())),
      Effect.catchTag("StorageFailure", (error) =>
        Effect.sync(() => setMessage(describeError(error, "This book"))),
      ),
    );

    void runApp(program);
  };

  const reparse = (id: string): void => {
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

  return {
    busy,
    importing,
    progress,
    message,
    setMessage,
    importFiles,
    cancelImport,
    remove,
    reparse,
  };
}
