// A module of its own, so this code loads on the first request, like pdf.js, and not at launch.
import { Effect, Stream } from "effect";
import type { AiProvider, AiSettings, PromptMessage, PromptPart } from "@/domain/ai";
import { AiFailure } from "@/domain/errors";
import { emptyEventStream, endEventStream, pushEventStream, type Delta } from "@/lib/event-stream";

// Every preset answers a browser page directly, measured on 7 October 2026; Anthropic alone gets its own API, for caching.
const bases: Record<Exclude<AiProvider, "compatible">, string> = {
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
  // The provider says this model may answer without thinking, so Off can turn its thinking off.
  readonly reasoningOff?: boolean;
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
  session = "reader-hero",
): Effect.Effect<Response, AiFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => {
        if (settings.provider !== "compatible")
          return fetch(`${bases[settings.provider]}${path}`, {
            ...init,
            headers: headers(settings),
          });
        // Its providers refuse browser requests, so they go through the app's own Worker.
        const base = settings.baseUrl ?? "";
        const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
        return fetch("/relay", {
          ...init,
          headers: {
            ...headers(settings),
            "x-relay-target": `${trimmed}${path}`,
            "x-opencode-session": session,
          },
        });
      },
      catch: networkFailure,
    });
    if (response.ok) return response;
    const body = yield* Effect.promise(() => response.text().catch(() => ""));
    return yield* statusFailure(response.status, body);
  });

export interface CompleteOptions {
  readonly json?: boolean;
  // What the request is for: the console line names it, and the book keys the provider's cache.
  readonly purpose?: { readonly stage: string; readonly book?: string };
}

const joined = (content: string | ReadonlyArray<PromptPart>): string =>
  typeof content === "string" ? content : content.map((part) => part.text).join("");

// Unmarked runs merged and empty parts dropped; null with no mark, so the plain string goes.
function marked(content: string | ReadonlyArray<PromptPart>): ReadonlyArray<PromptPart> | null {
  if (typeof content === "string" || !content.some((part) => part.cache === true)) return null;
  const out: Array<{ text: string; cache: boolean }> = [];
  for (const part of content) {
    const last = out[out.length - 1];
    if (last !== undefined && !last.cache) {
      last.text += part.text;
      last.cache = part.cache === true;
    } else {
      out.push({ text: part.text, cache: part.cache === true });
    }
  }
  return out.filter((part) => part.text !== "");
}

// GPT-5.6 and later bill a cache write at 1.25x, so there only the marked prefixes are kept.
export function writeBilled(model: string): boolean {
  const match = /^(?:openai\/)?gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (match === null) return false;
  const major = Number(match[1]);
  return major > 5 || (major === 5 && Number(match[2] ?? 0) >= 6);
}

export function requestOf(
  settings: AiSettings,
  system: string | ReadonlyArray<PromptPart>,
  messages: ReadonlyArray<PromptMessage>,
  options: CompleteOptions = {},
): { readonly path: string; readonly body: Record<string, unknown> } {
  const effort =
    settings.effort === undefined || settings.effort === "off" ? null : settings.effort;
  const purpose = options.purpose;
  const key = purpose === undefined ? undefined : `reader-hero:${purpose.book ?? purpose.stage}`;

  if (settings.provider === "anthropic") {
    const marks = [system, ...messages.map((message) => message.content)].reduce(
      (sum, content) => sum + (marked(content)?.filter((part) => part.cache === true).length ?? 0),
      0,
    );
    // Anthropic takes 4 breakpoints; the latest ones cover the longest prefixes.
    let drop = Math.max(0, marks - 4);
    const blocks = (content: string | ReadonlyArray<PromptPart>) => {
      const parts = marked(content);
      if (parts === null) return joined(content);
      return parts.map((part) => ({
        type: "text",
        text: part.text,
        ...(part.cache === true && drop-- <= 0 ? { cache_control: { type: "ephemeral" } } : {}),
      }));
    };
    return {
      path: "/messages",
      body: {
        model: settings.model,
        // A limit on thinking and text together, so high effort still has room to answer.
        max_tokens: 32000,
        system: blocks(system),
        messages: messages.map((message) => ({
          role: message.role,
          content: blocks(message.content),
        })),
        stream: true,
        ...(effort === null ? {} : { output_config: { effort } }),
      },
    };
  }

  const explicit =
    (settings.provider === "openai" || settings.provider === "openrouter") &&
    writeBilled(settings.model);
  // DeepSeek and Gemini cache every prefix with no write charge, so they take plain strings.
  const content = (value: string | ReadonlyArray<PromptPart>) => {
    const parts =
      settings.provider === "openrouter" || (settings.provider === "openai" && explicit)
        ? marked(value)
        : null;
    if (parts === null) return joined(value);
    return parts.map((part) => ({
      type: "text",
      text: part.text,
      ...(part.cache !== true
        ? {}
        : settings.provider === "openrouter"
          ? { cache_control: { type: "ephemeral" } }
          : { prompt_cache_breakpoint: { mode: "explicit" } }),
    }));
  };
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: [
      { role: "system", content: content(system) },
      ...messages.map((message) => ({ role: message.role, content: content(message.content) })),
    ],
    stream: true,
    stream_options: { include_usage: true },
  };
  // DeepSeek thinks by default and must be told not to; the others think only when asked.
  if (effort === null) {
    if (settings.provider === "deepseek") body.thinking = { type: "disabled" };
    if (settings.provider === "openrouter" && settings.reasoningOff === true)
      body.reasoning = { enabled: false };
    // The relay's providers are asked in the OpenAI way, which OpenCode maps to no thinking for DeepSeek.
    if (settings.provider === "compatible") body.reasoning_effort = "none";
  } else {
    body.reasoning_effort = effort;
  }
  // JSON mode where it is documented; the other presets get JSON from the prompt alone.
  if (
    options.json === true &&
    (settings.provider === "deepseek" || settings.provider === "openai")
  ) {
    body.response_format = { type: "json_object" };
  }
  if (explicit) body.prompt_cache_options = { mode: "explicit" };
  // OpenAI routes by the key to a machine with the cache; OpenRouter keeps the session on one provider.
  if (key !== undefined && settings.provider === "openai") body.prompt_cache_key = key;
  if (key !== undefined && settings.provider === "openrouter") body.session_id = key;
  return { path: "/chat/completions", body };
}

export function complete(
  settings: AiSettings,
  system: string | ReadonlyArray<PromptPart>,
  messages: ReadonlyArray<PromptMessage>,
  options: CompleteOptions = {},
): Stream.Stream<Delta, AiFailure> {
  return Stream.unwrap(
    Effect.gen(function* () {
      // Interrupting the stream aborts the request, the way a page render is cancelled today.
      const controller = new AbortController();
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
      const { path, body } = requestOf(settings, system, messages, options);
      const response = yield* request(
        settings,
        path,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        options.purpose === undefined
          ? undefined
          : `reader-hero:${options.purpose.book ?? options.purpose.stage}`,
      );
      const stream = response.body;
      if (stream === null) {
        return yield* new AiFailure({ reason: "malformed", message: "Provider returned no text" });
      }
      return Stream.fromReadableStream({
        evaluate: () => stream,
        onError: (cause) => new AiFailure({ reason: "provider", message: String(cause) }),
      }).pipe(
        Stream.decodeText(),
        Stream.mapAccum(() => emptyEventStream, pushEventStream, { onHalt: endEventStream }),
        // A provider can report a failure after its 200, and that must fail the stream.
        Stream.tap((delta) =>
          delta.type === "error"
            ? Effect.fail(new AiFailure({ reason: "provider", message: delta.message }))
            : Effect.void,
        ),
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
      // Only OpenRouter publishes whether a model may skip thinking.
      const reasoningOff =
        (row.reasoning as { mandatory?: boolean } | undefined)?.mandatory === false;
      const off = reasoningOff ? { reasoningOff: true } : {};
      if (Array.isArray(effort?.supported_levels))
        return [{ id, efforts: effort.supported_levels, ...off }];
      if (parameters?.includes("reasoning"))
        return [{ id, efforts: ["low", "medium", "high"], ...off }];
      return [{ id, ...off }];
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
