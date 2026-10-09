import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { GroupedBooks, type AiSettings } from "@/domain/ai";
import { DEFAULT_SETTINGS, ReaderSettings } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { decodeAiSettings, decodeGroupedBooks, decodeReaderSettings } from "@/lib/codecs";
import { AI_SETTINGS_KEY, openReaderDb, SETTINGS_KEY } from "@/lib/db";

const storageFailure = (operation: string) => (cause: unknown) =>
  new StorageFailure({ operation, cause });

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    changes(): Stream.Stream<ReaderSettings>;
    update(patch: Partial<ReaderSettings>): Effect.Effect<void, StorageFailure>;
    aiChanges(): Stream.Stream<AiSettings | null>;
    putAi(next: AiSettings | null): Effect.Effect<void, StorageFailure>;
    groupedBooks(): Effect.Effect<ReadonlyArray<string>, StorageFailure>;
    putGroupedBooks(ids: ReadonlyArray<string>): Effect.Effect<void, StorageFailure>;
  }
>()("reader-hero/SettingsStore") {
  static readonly layer = Layer.effect(
    SettingsStore,
    Effect.gen(function* () {
      const db = yield* Effect.tryPromise({
        try: () => openReaderDb(),
        catch: storageFailure("open"),
      });

      const stored = yield* Effect.tryPromise({
        try: () => db.get("settings", SETTINGS_KEY),
        catch: storageFailure("getSettings"),
      });

      const initial =
        stored === undefined
          ? DEFAULT_SETTINGS
          : yield* decodeReaderSettings(stored).pipe(
              Effect.catch(() => Effect.succeed(DEFAULT_SETTINGS)),
            );

      const ref = yield* SubscriptionRef.make(initial);

      const changes = () => SubscriptionRef.changes(ref);

      const update = Effect.fn("SettingsStore.update")(function* (patch: Partial<ReaderSettings>) {
        const current = yield* SubscriptionRef.get(ref);
        const next = new ReaderSettings({
          theme: patch.theme ?? current.theme,
          font: patch.font ?? current.font,
          fontSize: patch.fontSize ?? current.fontSize,
          lineHeight: patch.lineHeight ?? current.lineHeight,
          libraryView: patch.libraryView ?? current.libraryView,
          librarySort: patch.librarySort ?? current.librarySort,
          textWidth: patch.textWidth ?? current.textWidth,
          textAlign: patch.textAlign ?? current.textAlign,
          temperature: patch.temperature ?? current.temperature,
        });
        // Applied before the save, so a failed write still changes this session.
        yield* SubscriptionRef.set(ref, next);
        yield* Effect.tryPromise({
          try: () => db.put("settings", next, SETTINGS_KEY),
          catch: storageFailure("putSettings"),
        });
      });

      const storedAi = yield* Effect.tryPromise({
        try: () => db.get("settings", AI_SETTINGS_KEY),
        catch: storageFailure("getAiSettings"),
      });
      const aiRef = yield* SubscriptionRef.make<AiSettings | null>(
        storedAi === undefined
          ? null
          : yield* decodeAiSettings(storedAi).pipe(Effect.catch(() => Effect.succeed(null))),
      );

      const aiChanges = () => SubscriptionRef.changes(aiRef);

      const putAi = Effect.fn("SettingsStore.putAi")(function* (next: AiSettings | null) {
        yield* SubscriptionRef.set(aiRef, next);
        yield* Effect.tryPromise({
          try: async () => {
            if (next === null) await db.delete("settings", AI_SETTINGS_KEY);
            else await db.put("settings", next, AI_SETTINGS_KEY);
          },
          catch: storageFailure("putAiSettings"),
        });
      });

      // A record that no longer decodes counts as none sent, so grouping sends those books again.
      const groupedBooks = Effect.fn("SettingsStore.groupedBooks")(function* () {
        const row = yield* Effect.tryPromise({
          try: () => db.get("settings", "grouped"),
          catch: storageFailure("getGroupedBooks"),
        });
        if (row === undefined) return [];
        const decoded = yield* decodeGroupedBooks(row).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        return decoded?.ids ?? [];
      });

      const putGroupedBooks = Effect.fn("SettingsStore.putGroupedBooks")(function* (
        ids: ReadonlyArray<string>,
      ) {
        yield* Effect.tryPromise({
          try: () => db.put("settings", new GroupedBooks({ ids }), "grouped"),
          catch: storageFailure("putGroupedBooks"),
        });
      });

      return SettingsStore.of({
        changes,
        update,
        aiChanges,
        putAi,
        groupedBooks,
        putGroupedBooks,
      });
    }),
  );
}
