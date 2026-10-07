// A server-sent events parser for OpenAI-style chat completions. It is stateful because a chunk
// from the network can end in the middle of a line, and a provider under load sends comment lines
// such as ": keep-alive" between events.
export interface EventStreamState {
  readonly buffer: string;
  readonly data: ReadonlyArray<string>;
}

export const emptyEventStream: EventStreamState = { buffer: "", data: [] };

export type Delta = { readonly type: "text" | "reasoning"; readonly text: string };

// Feeds one chunk and returns the deltas of every event completed by it.
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
  const choice = (parsed as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0];
  const delta = choice?.delta;
  if (delta === undefined) return [];
  const out: Array<Delta> = [];
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content !== "") {
    out.push({ type: "reasoning", text: delta.reasoning_content });
  }
  if (typeof delta.content === "string" && delta.content !== "") {
    out.push({ type: "text", text: delta.content });
  }
  return out;
}
