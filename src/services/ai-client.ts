import { Context, Effect, Layer, Stream } from "effect";
import type { AiMessage, AiSettings } from "@/domain/ai";
import type { AiFailure } from "@/domain/errors";
import type { ModelInfo } from "@/lib/ai-transport";
import type { Delta } from "@/lib/event-stream";

// The presets, the fetch and the parser load on the first AI action, so launch does not pay for them.
const transport = () => Effect.promise(() => import("@/lib/ai-transport"));

export class AiClient extends Context.Service<
  AiClient,
  {
    complete(
      settings: AiSettings,
      system: string,
      messages: ReadonlyArray<AiMessage>,
    ): Stream.Stream<Delta, AiFailure>;
    models(settings: AiSettings): Effect.Effect<ReadonlyArray<ModelInfo>, AiFailure>;
    balance(settings: AiSettings): Effect.Effect<string | null, AiFailure>;
  }
>()("reader-hero/AiClient") {
  static readonly layer = Layer.succeed(
    AiClient,
    AiClient.of({
      complete: (settings, system, messages) =>
        Stream.unwrap(
          Effect.map(transport(), (module) => module.complete(settings, system, messages)),
        ),
      models: (settings) => Effect.flatMap(transport(), (module) => module.models(settings)),
      balance: (settings) => Effect.flatMap(transport(), (module) => module.balance(settings)),
    }),
  );
}
