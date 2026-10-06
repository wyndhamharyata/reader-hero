import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { DEFAULT_SETTINGS, ReaderSettings } from "@/domain/book";
import { StorageFailure } from "@/domain/errors";
import { decodeReaderSettings } from "@/lib/codecs";
import { openReaderDb, SETTINGS_KEY } from "@/lib/db";

const storageFailure = (operation: string) => (cause: unknown) =>
  new StorageFailure({ operation, cause });

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    changes(): Stream.Stream<ReaderSettings>;
    update(patch: Partial<ReaderSettings>): Effect.Effect<void, StorageFailure>;
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
        });
        // Applied before the save, so a failed write still changes this session.
        yield* SubscriptionRef.set(ref, next);
        yield* Effect.tryPromise({
          try: () => db.put("settings", next, SETTINGS_KEY),
          catch: storageFailure("putSettings"),
        });
      });

      return SettingsStore.of({ changes, update });
    }),
  );
}
