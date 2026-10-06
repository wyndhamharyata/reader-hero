import { Effect } from "effect";
import { PdfFailure, type StorageFailure, type UnsupportedFile } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import type { ParseProgress } from "./extract";
import { addPdf } from "./import-book";

// One file at a time: each import holds a whole PDF in the pdf.js worker, and the progress panel
// describes one file.
export function importPdfs(
  files: ReadonlyArray<File>,
  onProgress: (progress: ParseProgress) => void,
  onMessage: (message: string) => void,
): Effect.Effect<void, never, BookStore | PdfClient> {
  const failures: string[] = [];
  let added = 0;
  const summary = () => [`Added ${added} of ${files.length} books.`, ...failures].join("\n");

  const importOne = (
    file: File,
    index: number,
  ): Effect.Effect<void, never, BookStore | PdfClient> => {
    const report = (error: UnsupportedFile | PdfFailure | StorageFailure) =>
      Effect.sync(() => {
        failures.push(describeError(error, file.name));
        onMessage(summary());
      });

    // A hung pdf.js call (e.g. its worker lost to memory pressure) never settles, so a file that
    // reports no page for 60 seconds fails and the import moves on.
    let lastProgress = Date.now();
    let lastTick = Date.now();
    const stalled = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("5 seconds");
        const now = Date.now();
        // Timers stop while the app is in the background; that time is not a stall.
        if (now - lastTick > 15_000) lastProgress = now;
        lastTick = now;
        if (now - lastProgress > 60_000) {
          return yield* new PdfFailure({
            reason: "stalled",
            message: "No page read for 60 seconds",
          });
        }
      }
    });
    const progressFile = { index: index + 1, count: files.length, name: file.name };
    const work = addPdf(file, (progress) => {
      lastProgress = Date.now();
      onProgress({ ...progress, file: progressFile });
    });

    return Effect.raceFirst(work, stalled).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          added += 1;
        }),
      ),
      Effect.catchTags({ UnsupportedFile: report, PdfFailure: report, StorageFailure: report }),
    );
  };

  return Effect.forEach(files, importOne, { discard: true }).pipe(
    Effect.onInterrupt(() => Effect.sync(() => onMessage(`Import cancelled. ${summary()}`))),
    Effect.andThen(Effect.flatMap(BookStore, (store) => store.requestPersistent())),
  );
}
