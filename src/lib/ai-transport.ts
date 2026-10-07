// The network side of the AI client: presets, headers, the chat stream and the models list. It is a
// separate module so the AI code loads on the first action, like pdf.js, and not at launch.
import { Effect, Stream } from "effect";
import type { AiMessage, AiProvider, AiSettings } from "@/domain/ai";
import { AiFailure } from "@/domain/errors";
import { emptyEventStream, endEventStream, pushEventStream, type Delta } from "@/lib/event-stream";

// Every preset speaks OpenAI chat completions and answers a browser page directly, measured on 7 October 2026.
const bases: Record<AiProvider, string> = {
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

export interface ModelInfo {
  readonly id: string;
  // The effort levels the provider lists for this model; undefined when it lists none.
  readonly efforts?: ReadonlyArray<string>;
}

function headers(settings: AiSettings): Record<string, string> {
  const base: Record<string, string> = {
    authorization: `Bearer ${settings.apiKey}`,
    "content-type": "application/json",
  };
  if (settings.provider !== "anthropic") return base;
  return {
    ...base,
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

const networkFailure = (): AiFailure =>
  new AiFailure({
    reason: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "provider",
    message: "No response from the provider",
  });

const statusFailure = (status: number, body: string): AiFailure => {
  const reason =
    status === 401 || status === 403
      ? "unauthorized"
      : status === 429
        ? "rate-limited"
        : "provider";
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // The body was not JSON; the raw text is the message.
  }
  return new AiFailure({ reason, message: message === "" ? `HTTP ${status}` : message });
};

const request = (
  settings: AiSettings,
  path: string,
  init: RequestInit,
): Effect.Effect<Response, AiFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${bases[settings.provider]}${path}`, { ...init, headers: headers(settings) }),
      catch: networkFailure,
    });
    if (response.ok) return response;
    const body = yield* Effect.promise(() => response.text().catch(() => ""));
    return yield* statusFailure(response.status, body);
  });

export function complete(
  settings: AiSettings,
  system: string,
  messages: ReadonlyArray<AiMessage>,
  options: { readonly json?: boolean } = {},
): Stream.Stream<Delta, AiFailure> {
  return Stream.unwrap(
    Effect.gen(function* () {
      // Interrupting the stream aborts the request, the way a page render is cancelled today.
      const controller = new AbortController();
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
      const body: Record<string, unknown> = {
        model: settings.model,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
      };
      // DeepSeek thinks by default and must be told not to; the others think only when asked.
      if (settings.effort === undefined || settings.effort === "off") {
        if (settings.provider === "deepseek") body.thinking = { type: "disabled" };
      } else {
        body.reasoning_effort = settings.effort;
      }
      // JSON mode where it is documented; the other presets get JSON from the prompt alone.
      if (
        options.json === true &&
        (settings.provider === "deepseek" || settings.provider === "openai")
      ) {
        body.response_format = { type: "json_object" };
      }
      const response = yield* request(settings, "/chat/completions", {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const stream = response.body;
      if (stream === null) {
        return yield* new AiFailure({ reason: "malformed", message: "Empty response" });
      }
      return Stream.fromReadableStream({
        evaluate: () => stream,
        onError: (cause) => new AiFailure({ reason: "provider", message: String(cause) }),
      }).pipe(
        Stream.decodeText(),
        Stream.mapAccum(() => emptyEventStream, pushEventStream, { onHalt: endEventStream }),
      );
    }),
  );
}

export function models(settings: AiSettings): Effect.Effect<ReadonlyArray<ModelInfo>, AiFailure> {
  return Effect.gen(function* () {
    const response = yield* request(settings, "/models", { method: "GET" });
    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ data?: Array<Record<string, unknown>> }>,
      catch: () => new AiFailure({ reason: "malformed", message: "The models list was not JSON" }),
    });
    const rows = json.data ?? [];
    return rows.flatMap((row): Array<ModelInfo> => {
      if (typeof row.id !== "string") return [];
      // Gemini lists "models/gemini-…"; its chat endpoint takes the bare name.
      const id = row.id.startsWith("models/") ? row.id.slice(7) : row.id;
      const effort = row.effort as { supported_levels?: Array<string> } | undefined;
      const parameters = row.supported_parameters as Array<string> | undefined;
      if (Array.isArray(effort?.supported_levels))
        return [{ id, efforts: effort.supported_levels }];
      if (parameters?.includes("reasoning")) return [{ id, efforts: ["low", "medium", "high"] }];
      return [{ id }];
    });
  });
}

// DeepSeek alone exposes a balance; the sheet shows it next to the key.
export function balance(settings: AiSettings): Effect.Effect<string | null, AiFailure> {
  if (settings.provider !== "deepseek") return Effect.succeed(null);
  return Effect.gen(function* () {
    const response = yield* request(settings, "/user/balance", { method: "GET" });
    const json = yield* Effect.tryPromise({
      try: () =>
        response.json() as Promise<{
          balance_infos?: Array<{ currency?: string; total_balance?: string }>;
        }>,
      catch: () => new AiFailure({ reason: "malformed", message: "The balance was not JSON" }),
    });
    const info = json.balance_infos?.[0];
    if (info?.total_balance === undefined) return null;
    return `${info.currency ?? ""} ${info.total_balance}`.trim();
  });
}
