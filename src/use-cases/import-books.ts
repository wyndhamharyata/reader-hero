import { Effect, Ref, Stream } from "effect";
import type { BookMeta } from "@/domain/book";
import {
  PdfFailure,
  type EpubFailure,
  type StorageFailure,
  type UnsupportedFile,
} from "@/domain/errors";
import { describeError } from "@/lib/describe-error";
import { BookStore } from "@/services/book-store";
import type { PdfClient } from "@/services/pdf-client";
import type { ParseProgress } from "./extract";
import { addBook } from "./import-book";

// One file at a time: each import holds a whole book in memory.
export function importBooks(
  files: ReadonlyArray<File>,
  onProgress: (progress: ParseProgress) => void,
  onMessage: (message: string) => void,
): Effect.Effect<void, never, BookStore | PdfClient> {
  return Effect.gen(function* () {
    const store = yield* BookStore;
    // The same name and size is the same file, sent here again; importing it twice helps no one.
    const held = (file: File): string => `${file.name}|${file.size}`;
    // A library that cannot be read yet counts as empty, so such a shelf still imports.
    const stored = yield* store
      .list()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<BookMeta> => []));
    const known = new Set(stored.map((book) => `${book.fileName ?? ""}|${book.fileSize}`));
    const skipped = files.filter((file) => known.has(held(file)));
    const wanted = files.flatMap((file, index) => (known.has(held(file)) ? [] : [{ file, index }]));
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
    }): string =>
      [
        `Added ${added} of ${files.length} books.`,
        ...(skipped.length === 0
          ? []
          : [`Already in the library: ${skipped.map((file) => file.name).join(", ")}.`]),
        ...failures,
      ].join("\n");
    // Shown before the imports, so a batch of books already in the library says so at once.
    if (skipped.length > 0) onMessage(summary({ added: 0, failures: [] }));

    const importOne = (
      file: File,
      index: number,
    ): Effect.Effect<void, never, BookStore | PdfClient> => {
      const report = (
        error: UnsupportedFile | PdfFailure | EpubFailure | StorageFailure,
      ): Effect.Effect<void> =>
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
      const work = addBook(file, (progress) => {
        lastProgress = Date.now();
        onProgress({ ...progress, file: progressFile });
      });

      return Effect.raceFirst(work, stalled).pipe(
        Effect.tap(() =>
          Ref.update(tally, (current) => ({ ...current, added: current.added + 1 })),
        ),
        Effect.catchTags({
          UnsupportedFile: report,
          PdfFailure: report,
          EpubFailure: report,
          StorageFailure: report,
        }),
      );
    };

    yield* Stream.fromIterable(wanted).pipe(
      Stream.mapEffect(({ file, index }) => importOne(file, index)),
      Stream.runDrain,
      Effect.onInterrupt(() =>
        Ref.get(tally).pipe(
          Effect.flatMap((current) =>
            Effect.sync(() => onMessage(`Import cancelled. ${summary(current)}`)),
          ),
        ),
      ),
    );
    yield* store.requestPersistent();
  });
}
