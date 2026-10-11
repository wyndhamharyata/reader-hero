import { Context, Effect, Layer, Stream } from "effect";
import type { AiSettings, AiUsage, PromptMessage, PromptPart } from "@/domain/ai";
import { AiFailure } from "@/domain/errors";
import type { CompleteOptions, ModelInfo } from "@/lib/ai-transport";
import type { Delta } from "@/lib/event-stream";
import { SettingsStore } from "@/services/settings-store";

// Loaded on the first request, so launch does not pay for it; a failed load is a failure, not a defect.
const transport = (): Effect.Effect<typeof import("@/lib/ai-transport"), AiFailure> =>
  Effect.tryPromise({
    try: () => import("@/lib/ai-transport"),
    catch: () =>
      new AiFailure({
        reason: navigator.onLine ? "provider" : "offline",
        message: "The request code did not load",
      }),
  });

export class AiClient extends Context.Service<
  AiClient,
  {
    complete(
      settings: AiSettings,
      system: string | ReadonlyArray<PromptPart>,
      messages: ReadonlyArray<PromptMessage>,
      options?: CompleteOptions,
    ): Stream.Stream<Delta, AiFailure>;
    models(settings: AiSettings): Effect.Effect<ReadonlyArray<ModelInfo>, AiFailure>;
    balance(settings: AiSettings): Effect.Effect<string | null, AiFailure>;
  }
>()("reader-hero/AiClient") {
  static readonly layer = Layer.effect(
    AiClient,
    Effect.gen(function* () {
      const store = yield* SettingsStore;

      // A stopped request reports nothing, so only a finished one counts.
      const record = (
        settings: AiSettings,
        options: CompleteOptions | undefined,
        usage: AiUsage,
      ): Effect.Effect<void> => {
        if (usage.input === undefined) return Effect.void;
        const hit = usage.hit ?? 0;
        const write = usage.write ?? 0;
        const purpose = options?.purpose;
        console.info(
          `[ai] ${purpose?.stage ?? "request"}${purpose?.book === undefined ? "" : ` ${purpose.book}`} · ${settings.provider}/${settings.model} · input ${usage.input}, hit ${hit}, write ${write}, miss ${usage.input - hit - write}, output ${usage.output ?? 0}`,
        );
        return store
          .addUsage(`${settings.provider}/${settings.model}`, usage)
          .pipe(Effect.catchTag("StorageFailure", () => Effect.void));
      };

      return AiClient.of({
        complete: (settings, system, messages, options) =>
          Stream.unwrap(
            Effect.map(transport(), (module) => {
              // Anthropic reports the input at the start and the output at the end, so later fields win.
              let usage: AiUsage = {};
              return module.complete(settings, system, messages, options).pipe(
                Stream.tap((delta) =>
                  Effect.sync(() => {
                    if (delta.type !== "usage") return;
                    for (const [field, value] of Object.entries(delta.usage)) {
                      if (value !== undefined) usage = { ...usage, [field]: value };
                    }
                  }),
                ),
                Stream.onEnd(Effect.suspend(() => record(settings, options, usage))),
              );
            }),
          ),
        models: (settings) => Effect.flatMap(transport(), (module) => module.models(settings)),
        balance: (settings) => Effect.flatMap(transport(), (module) => module.balance(settings)),
      });
    }),
  );
}
