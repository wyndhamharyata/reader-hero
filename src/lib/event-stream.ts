// Stateful: a network chunk can end mid-line, and a provider under load sends ": keep-alive" lines.
export interface EventStreamState {
  readonly buffer: string;
  readonly data: ReadonlyArray<string>;
}

export const emptyEventStream: EventStreamState = { buffer: "", data: [] };

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

// The stream ended: a last event without its blank line still counts.
export function endEventStream(state: EventStreamState): ReadonlyArray<Delta> {
  const data = state.buffer.startsWith("data:")
    ? [...state.data, state.buffer.slice(5).trimStart()]
    : state.data;
  return deltasOf(data);
}

function deltasOf(data: ReadonlyArray<string>): ReadonlyArray<Delta> {
  if (data.length === 0) return [];
  const payload = data.join("\n");
  if (payload === "[DONE]") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  // A provider that fails after its 200 sends the reason here, OpenAI-style or Anthropic-style.
  const failure = (parsed as { error?: unknown }).error;
  if (typeof failure === "string") return [{ type: "error", message: failure }];
  if (typeof failure === "object" && failure !== null) {
    const message = (failure as { message?: unknown }).message;
    return [
      {
        type: "error",
        message: typeof message === "string" ? message : JSON.stringify(failure).slice(0, 200),
      },
    ];
  }
  if (typeof (parsed as { type?: unknown }).type === "string") return anthropicDeltas(parsed);
  const chunk = parsed as {
    choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: unknown }>;
    usage?: Record<string, unknown> | null;
  };
  const out: Array<Delta> = [];
  const delta = chunk.choices?.[0]?.delta;
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content !== "") {
    out.push({ type: "reasoning", text: delta.reasoning_content });
  }
  if (typeof delta?.content === "string" && delta.content !== "") {
    out.push({ type: "text", text: delta.content });
  }
  // The last chunk carries the usage, with no choices on OpenAI.
  if (typeof chunk.usage === "object" && chunk.usage !== null) {
    const usage = chunk.usage;
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    out.push({
      type: "usage",
      usage: {
        input: count(usage.prompt_tokens),
        // DeepSeek names its hits itself; the others report them as cached tokens.
        hit: count(usage.prompt_cache_hit_tokens) ?? count(details?.cached_tokens) ?? 0,
        write: count(details?.cache_write_tokens) ?? 0,
        output: count(usage.completion_tokens),
      },
    });
  }
  // Any reason but these means the provider stopped the reply on purpose, often a filter.
  const finish = chunk.choices?.[0]?.finish_reason;
  if (
    typeof finish === "string" &&
    !["stop", "length", "tool_calls", "function_call"].includes(finish)
  )
    out.push({ type: "error", message: `The provider stopped this reply: ${finish}` });
  return out;
}

// Anthropic's own events: the start carries the input, and each message delta the output so far.
function anthropicDeltas(event: unknown): ReadonlyArray<Delta> {
  const { type, delta, message, usage } = event as {
    type: string;
    delta?: Record<string, unknown>;
    message?: { usage?: Record<string, unknown> };
    usage?: Record<string, unknown>;
  };
  if (type === "content_block_delta") {
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
  const counts =
    type === "message_start" ? message?.usage : type === "message_delta" ? usage : undefined;
  if (counts === undefined) return [];
  const plain = count(counts.input_tokens);
  const read = count(counts.cache_read_input_tokens);
  const written = count(counts.cache_creation_input_tokens);
  // Anthropic's input count leaves out the cached tokens, so the three add up to the whole prompt.
  const reported = plain !== undefined || read !== undefined || written !== undefined;
  return [
    {
      type: "usage",
      usage: {
        ...(reported
          ? {
              input: (plain ?? 0) + (read ?? 0) + (written ?? 0),
              hit: read ?? 0,
              write: written ?? 0,
            }
          : {}),
        ...(count(counts.output_tokens) === undefined
          ? {}
          : { output: count(counts.output_tokens) }),
      },
    },
  ];
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
