import { Context, Effect, Layer, Stream } from "effect";
import type { AiMessage, AiSettings } from "@/domain/ai";
import { AiFailure } from "@/domain/errors";
import type { ModelInfo } from "@/lib/ai-transport";
import type { Delta } from "@/lib/event-stream";

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
      system: string,
      messages: ReadonlyArray<AiMessage>,
      options?: { readonly json?: boolean },
    ): Stream.Stream<Delta, AiFailure>;
    models(settings: AiSettings): Effect.Effect<ReadonlyArray<ModelInfo>, AiFailure>;
    balance(settings: AiSettings): Effect.Effect<string | null, AiFailure>;
  }
>()("reader-hero/AiClient") {
  static readonly layer = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (settings, system, messages, options) =>
        Stream.unwrap(
          Effect.map(transport(), (module) => module.complete(settings, system, messages, options)),
        ),
      models: (settings) => Effect.flatMap(transport(), (module) => module.models(settings)),
      balance: (settings) => Effect.flatMap(transport(), (module) => module.balance(settings)),
    }),
  );
}
