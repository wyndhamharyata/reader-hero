import { Effect, Ref, Stream } from "effect";
import { PdfFailure, type StorageFailure, type UnsupportedFile } from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import type { ParseProgress } from "./extract";
import { addPdf } from "./import-book";

// One file at a time: each import holds a whole PDF in the pdf.js worker.
export function importPdfs(
  files: ReadonlyArray<File>,
  onProgress: (progress: ParseProgress) => void,
  onMessage: (message: string) => void,
): Effect.Effect<void, never, BookStore | PdfClient> {
  return Effect.gen(function* () {
    const tally = yield* Ref.make<{ added: number; failures: ReadonlyArray<string> }>({
      added: 0,
      failures: [],
    });
    const summary = ({
      added,
      failures,
    }: {
      added: number;
      failures: ReadonlyArray<string>;
    }): string => [`Added ${added} of ${files.length} books.`, ...failures].join("\n");

    const importOne = (
      file: File,
      index: number,
    ): Effect.Effect<void, never, BookStore | PdfClient> => {
      const report = (error: UnsupportedFile | PdfFailure | StorageFailure): Effect.Effect<void> =>
        Ref.updateAndGet(tally, (current) => ({
          ...current,
          failures: [...current.failures, describeError(error, file.name)],
        })).pipe(Effect.flatMap((current) => Effect.sync(() => onMessage(summary(current)))));

      // A hung pdf.js call (its worker lost to memory pressure) never settles; 60 s with no page fails the file.
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
          Ref.update(tally, (current) => ({ ...current, added: current.added + 1 })),
        ),
        Effect.catchTags({ UnsupportedFile: report, PdfFailure: report, StorageFailure: report }),
      );
    };

    yield* Stream.fromIterable(files).pipe(
      Stream.zipWithIndex,
      Stream.mapEffect(([file, index]) => importOne(file, index)),
      Stream.runDrain,
      Effect.onInterrupt(() =>
        Ref.get(tally).pipe(
          Effect.flatMap((current) =>
            Effect.sync(() => onMessage(`Import cancelled. ${summary(current)}`)),
          ),
        ),
      ),
    );
    yield* Effect.flatMap(BookStore, (store) => store.requestPersistent());
  });
}
