import { Effect, Stream } from "effect";
import type { PdfFailure, StorageFailure, UnsupportedFile } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import type { ParseProgress } from "./extract";
import { addPdf } from "./import-book";

const IMPORT_CONCURRENCY = 2;

export function importPdfs(
  files: ReadonlyArray<File>,
  onProgress: (progress: ParseProgress) => void,
  onMessage: (message: string) => void,
): Effect.Effect<void, never, BookStore | PdfClient> {
  const importOne = (file: File): Effect.Effect<void, never, BookStore | PdfClient> => {
    const report = (error: UnsupportedFile | PdfFailure | StorageFailure) =>
      Effect.sync(() => onMessage(describeError(error, file.name)));
    return addPdf(file, onProgress).pipe(
      Effect.catchTags({ UnsupportedFile: report, PdfFailure: report, StorageFailure: report }),
    );
  };

  return Stream.fromIterable(files).pipe(
    Stream.mapEffect(importOne, { concurrency: IMPORT_CONCURRENCY }),
    Stream.runDrain,
    Effect.andThen(Effect.flatMap(BookStore, (store) => store.requestPersistent())),
  );
}
