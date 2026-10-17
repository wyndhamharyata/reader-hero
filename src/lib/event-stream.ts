// Stateful, as a network chunk can end mid-line and a provider under load sends ": keep-alive" lines.
export interface EventStreamState {
  readonly buffer: string;
  readonly data: ReadonlyArray<string>;
}

export const emptyEventStream: EventStreamState = { buffer: "", data: [] };

import { Option } from "effect";
import type { AiUsage } from "@/domain/ai";

export type Delta =
  | { readonly type: "text" | "reasoning"; readonly text: string }
  | { readonly type: "usage"; readonly usage: AiUsage }
  | { readonly type: "error"; readonly message: string };

export function pushEventStream(
  state: EventStreamState,
  chunk: string,
): readonly [EventStreamState, ReadonlyArray<Delta>] {
  const text = state.buffer + chunk;
  const lines = text.split("\n");
  const buffer = lines.pop() ?? "";
  let data = [...state.data];
  const out: Array<Delta> = [];

  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line === "") {
      out.push(...deltasOf(data));
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  return [{ buffer, data }, out];
}

// The stream ended, with a last event without its blank line still counted.
export function endEventStream(state: EventStreamState): ReadonlyArray<Delta> {
  const data = state.buffer.startsWith("data:")
    ? [...state.data, state.buffer.slice(5).trimStart()]
    : state.data;

  return deltasOf(data);
}

function parsePayload(payload: string): unknown {
  return Option.getOrUndefined(Option.liftThrowable(JSON.parse)(payload));
}

function failureDelta(parsed: unknown): Delta | null {
  // A provider that fails after its 200 sends the reason here, OpenAI-style or Anthropic-style.
  const failure = (parsed as { error?: unknown }).error;

  if (typeof failure === "string") return { type: "error", message: failure };
  if (typeof failure !== "object" || failure === null) return null;

  const message = (failure as { message?: unknown }).message;

  return {
    type: "error",
    message: typeof message === "string" ? message : JSON.stringify(failure).slice(0, 200),
  };
}

function deltasOf(data: ReadonlyArray<string>): ReadonlyArray<Delta> {
  if (data.length === 0) return [];

  const payload = data.join("\n");

  if (payload === "[DONE]") return [];

  const parsed = parsePayload(payload);

  if (parsed === undefined) return [];

  const failure = failureDelta(parsed);

  if (failure !== null) return [failure];
  if (typeof (parsed as { type?: unknown }).type === "string") return anthropicDeltas(parsed);

  return openAiDeltas(parsed);
}

interface OpenAiChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: Record<string, unknown>;
    readonly finish_reason?: unknown;
  }>;
  readonly usage?: Record<string, unknown> | null;
}

function openAiDeltas(parsed: unknown): ReadonlyArray<Delta> {
  const chunk = parsed as OpenAiChunk;
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const out: Array<Delta> = [];

  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content !== "") {
    out.push({ type: "reasoning", text: delta.reasoning_content });
  }

  if (typeof delta?.content === "string" && delta.content !== "") {
    out.push({ type: "text", text: delta.content });
  }

  const usage = usageDelta(chunk.usage);

  if (usage !== null) out.push(usage);

  out.push(...finishDeltas(choice?.finish_reason));

  return out;
}

function usageDelta(usage: Record<string, unknown> | null | undefined): Delta | null {
  // The last chunk carries the usage, with no choices on OpenAI.
  if (typeof usage !== "object" || usage === null) return null;

  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;

  return {
    type: "usage",
    usage: {
      input: count(usage.prompt_tokens),
      // DeepSeek names its hits itself. The others report them as cached tokens.
      hit: count(usage.prompt_cache_hit_tokens) ?? count(details?.cached_tokens) ?? 0,
      write: count(details?.cache_write_tokens) ?? 0,
      output: count(usage.completion_tokens),
    },
  };
}

function finishDeltas(finish: unknown): ReadonlyArray<Delta> {
  if (finish === "length") return [{ type: "error", message: "The provider cut this reply short" }];
  // Any reason but these means the provider stopped the reply on purpose, often a filter.
  if (typeof finish === "string" && !["stop", "tool_calls", "function_call"].includes(finish)) {
    return [{ type: "error", message: `The provider stopped this reply: ${finish}` }];
  }

  return [];
}

interface AnthropicEvent {
  readonly type: string;
  readonly delta?: Record<string, unknown>;
  readonly message?: { readonly usage?: Record<string, unknown> };
  readonly usage?: Record<string, unknown>;
}

// Anthropic's own events. The start carries the input. Each message delta carries the output so far.
function anthropicDeltas(event: unknown): ReadonlyArray<Delta> {
  const { type, delta, message, usage } = event as AnthropicEvent;

  if (type === "content_block_delta") return anthropicContentDelta(delta);

  const stop = type === "message_delta" ? delta?.stop_reason : undefined;
  const stopped = stopDeltas(stop);
  const counts =
    type === "message_start" ? message?.usage : type === "message_delta" ? usage : undefined;

  if (counts === undefined) return stopped;

  return [anthropicUsage(counts), ...stopped];
}

function anthropicContentDelta(delta: Record<string, unknown> | undefined): ReadonlyArray<Delta> {
  if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") {
    return [{ type: "text", text: delta.text }];
  }

  if (
    delta?.type === "thinking_delta" &&
    typeof delta.thinking === "string" &&
    delta.thinking !== ""
  ) {
    return [{ type: "reasoning", text: delta.thinking }];
  }

  return [];
}

function stopDeltas(stop: unknown): ReadonlyArray<Delta> {
  // A cut-off or refused reply is not a whole one to keep.
  if (stop === "max_tokens")
    return [{ type: "error", message: "The provider cut this reply short" }];
  if (stop === "refusal") {
    return [{ type: "error", message: "The provider stopped this reply: refusal" }];
  }

  return [];
}

function anthropicUsage(counts: Record<string, unknown>): Delta {
  const plain = count(counts.input_tokens);
  const read = count(counts.cache_read_input_tokens);
  const written = count(counts.cache_creation_input_tokens);
  // Anthropic's input count omits the cached tokens, so the three add up to the whole prompt.
  const reported = plain !== undefined || read !== undefined || written !== undefined;
  const output = count(counts.output_tokens);

  return {
    type: "usage",
    usage: {
      ...(reported
        ? {
            input: (plain ?? 0) + (read ?? 0) + (written ?? 0),
            hit: read ?? 0,
            write: written ?? 0,
          }
        : {}),
      ...(output === undefined ? {} : { output }),
    },
  };
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
