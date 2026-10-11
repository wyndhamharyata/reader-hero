import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { GroupedBooks, UsageTally, type AiSettings, type AiUsage } from "@/domain/ai";
import { DEFAULT_SETTINGS, ReaderSettings } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import {
  decodeAiSettings,
  decodeGroupedBooks,
  decodeReaderSettings,
  decodeUsageTally,
} from "@/lib/codecs";
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
    // By "provider/model"; each request adds its reported tokens.
    usageChanges(): Stream.Stream<ReadonlyMap<string, UsageTally>>;
    addUsage(key: string, usage: AiUsage): Effect.Effect<void, StorageFailure>;
    resetUsage(key: string): Effect.Effect<void, StorageFailure>;
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

      const usageKeys = yield* Effect.tryPromise({
        try: () => db.getAllKeys("settings"),
        catch: storageFailure("getUsageKeys"),
      });
      const tallies = yield* Effect.forEach(
        usageKeys.filter((key) => key.startsWith("usage:")),
        (key) =>
          Effect.tryPromise({
            try: () => db.get("settings", key),
            catch: storageFailure("getUsage"),
          }).pipe(
            Effect.flatMap((row) => decodeUsageTally(row)),
            Effect.map((tally) => [[key.slice(6), tally] as const]),
            // A tally that no longer decodes starts again from nothing.
            Effect.catchTag("SchemaError", () => Effect.succeed([])),
          ),
      );
      const usageRef = yield* SubscriptionRef.make<ReadonlyMap<string, UsageTally>>(
        new Map(tallies.flat()),
      );

      const usageChanges = () => SubscriptionRef.changes(usageRef);

      const addUsage = Effect.fn("SettingsStore.addUsage")(function* (key: string, usage: AiUsage) {
        const next = yield* SubscriptionRef.modify(usageRef, (current) => {
          const before = current.get(key);
          const tally = new UsageTally({
            requests: (before?.requests ?? 0) + 1,
            input: (before?.input ?? 0) + (usage.input ?? 0),
            hit: (before?.hit ?? 0) + (usage.hit ?? 0),
            write: (before?.write ?? 0) + (usage.write ?? 0),
            output: (before?.output ?? 0) + (usage.output ?? 0),
            since: before?.since ?? Date.now(),
          });
          return [tally, new Map(current).set(key, tally)];
        });
        yield* Effect.tryPromise({
          try: () => db.put("settings", next, `usage:${key}`),
          catch: storageFailure("putUsage"),
        });
      });

      const resetUsage = Effect.fn("SettingsStore.resetUsage")(function* (key: string) {
        yield* SubscriptionRef.update(usageRef, (current) => {
          const next = new Map(current);
          next.delete(key);
          return next;
        });
        yield* Effect.tryPromise({
          try: () => db.delete("settings", `usage:${key}`),
          catch: storageFailure("deleteUsage"),
        });
      });

      return SettingsStore.of({
        changes,
        update,
        aiChanges,
        putAi,
        groupedBooks,
        putGroupedBooks,
        usageChanges,
        addUsage,
        resetUsage,
      });
    }),
  );
}
