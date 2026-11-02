import { Effect } from "effect";
import { useRef, useState } from "react";
import type { ReadingProgress } from "@/domain/book";
import { describeError } from "@/lib/describe-error";
import { forkApp, runApp, stopFiber, type Job } from "@/lib/hooks";
import type { AppServices } from "@/runtime";
import { resetBookCover, setBookCover } from "@/use-cases/book-image";
import type { ParseProgress } from "@/use-cases/extract";
import { importBooks } from "@/use-cases/import-books";
import { reparseBook } from "@/use-cases/parse-book";
import { removeBook } from "@/use-cases/remove-book";
import { setBookFinished } from "@/use-cases/save-progress";
import { hideSeries, saveSeries, setBookSeries } from "@/use-cases/series";

export type SeriesEdit = Parameters<typeof saveSeries>[0];

export function useLibraryActions(reload: () => void): {
  readonly isBusy: boolean;
  readonly isImporting: boolean;
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
  readonly setFinished: (id: string, isFinished: boolean, place: ReadingProgress | null) => void;
  readonly setSeries: (id: string, seriesId: string | null) => void;
  readonly setCover: (id: string, picture: File) => void;
  readonly resetCover: (id: string) => void;
  readonly editSeries: (edit: SeriesEdit) => void;
  readonly removeSeries: (id: string, name: string) => void;
} {
  const [isBusy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [isImporting, setImporting] = useState(false);
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

  // Each edit clears the last message, and a failed one says what failed.
  const runEdit = <E extends Parameters<typeof describeError>[0]>(
    program: Effect.Effect<unknown, E, AppServices>,
    subject: string,
  ): void => {
    setMessage(null);
    void runApp(
      program.pipe(
        Effect.catch((error: E) => Effect.sync(() => setMessage(describeError(error, subject)))),
      ),
    );
  };

  const setCover = (id: string, picture: File): void => {
    const program = setBookCover(id, picture).pipe(
      Effect.flatMap((saved) =>
        Effect.sync(() => {
          if (!saved) setMessage(`${picture.name} is not a picture Reader Hero can read.`);
        }),
      ),
    );

    runEdit(program, "This cover");
  };

  return {
    setFinished: (id, isFinished, place) =>
      runEdit(setBookFinished(id, isFinished, place), "This book"),
    setSeries: (id, seriesId) => runEdit(setBookSeries(id, seriesId), "This series"),
    setCover,
    resetCover: (id) => runEdit(resetBookCover(id), "This cover"),
    editSeries: (edit) => runEdit(saveSeries(edit), "This series"),
    removeSeries: (id, name) => runEdit(hideSeries(id, name), "This series"),
    isBusy,
    isImporting,
    progress,
    message,
    setMessage,
    importFiles,
    cancelImport,
    remove,
    reparse,
  };
}
