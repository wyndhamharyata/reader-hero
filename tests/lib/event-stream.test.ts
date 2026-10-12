import { describe, expect, it } from "vitest";
import {
  emptyEventStream,
  endEventStream,
  pushEventStream,
  type Delta,
  type EventStreamState,
} from "@/lib/event-stream";

const event = (delta: Record<string, string>): string =>
  `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

const raw = (payload: string): string => `data: ${payload}\n\n`;

function collect(chunks: ReadonlyArray<string>): Array<Delta> {
  let state: EventStreamState = emptyEventStream;
  const out: Array<Delta> = [];
  for (const chunk of chunks) {
    const [next, deltas] = pushEventStream(state, chunk);
    state = next;
    out.push(...deltas);
  }
  out.push(...endEventStream(state));
  return out;
}

describe("event stream parser", () => {
  it("given two events in one chunk, yields a text delta for each", () => {
    expect(collect([event({ content: "Jim " }) + event({ content: "fled." })])).toEqual([
      { type: "text", text: "Jim " },
      { type: "text", text: "fled." },
    ]);
  });

  it("given a chunk cut in the middle of a line, waits for the rest", () => {
    const whole = event({ content: "Hello" });
    const cut = whole.indexOf("Hel");
    expect(collect([whole.slice(0, cut), whole.slice(cut)])).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  it("given keep-alive comment lines and CRLF, ignores them", () => {
    expect(collect([": keep-alive\r\n\r\n", ": keep-alive\n", event({ content: "a" })])).toEqual([
      { type: "text", text: "a" },
    ]);
  });

  it("given reasoning content, yields it on its own channel", () => {
    expect(collect([event({ reasoning_content: "thinking", content: "" })])).toEqual([
      { type: "reasoning", text: "thinking" },
    ]);
  });

  it("given [DONE] and an unparsable event, yields nothing for them", () => {
    expect(collect(["data: [DONE]\n\n", "data: {not json\n\n", "data: {}\n\n"])).toEqual([]);
  });

  it("given a last event with no blank line after it, flushes it at the end", () => {
    expect(collect([event({ content: "x" }).trimEnd()])).toEqual([{ type: "text", text: "x" }]);
  });

  it("given OpenAI's last chunk with no choices, yields its cached and written tokens", () => {
    const usage = {
      prompt_tokens: 3000,
      completion_tokens: 120,
      prompt_tokens_details: { cached_tokens: 2048, cache_write_tokens: 512 },
    };
    expect(collect([`data: ${JSON.stringify({ choices: [], usage })}\n\n`])).toEqual([
      { type: "usage", usage: { input: 3000, hit: 2048, write: 512, output: 120 } },
    ]);
  });

  it("given DeepSeek's usage, reads its own hit count", () => {
    const usage = {
      prompt_tokens: 5000,
      completion_tokens: 150,
      prompt_cache_hit_tokens: 4096,
      prompt_cache_miss_tokens: 904,
    };
    const chunk = { choices: [{ delta: { content: "" } }], usage };
    expect(collect([`data: ${JSON.stringify(chunk)}\n\n`])).toEqual([
      { type: "usage", usage: { input: 5000, hit: 4096, write: 0, output: 150 } },
    ]);
  });

  it("given a null usage on a middle chunk, yields only its text", () => {
    const chunk = { choices: [{ delta: { content: "a" } }], usage: null };
    expect(collect([`data: ${JSON.stringify(chunk)}\n\n`])).toEqual([{ type: "text", text: "a" }]);
  });

  it("given an OpenAI-style error payload, yields its message", () => {
    expect(
      collect([raw('{"error":{"message":"Rate limit reached for gemini-3.5-flash-lite"}}')]),
    ).toEqual([{ type: "error", message: "Rate limit reached for gemini-3.5-flash-lite" }]);
  });

  it("given an Anthropic-style error event, yields its message", () => {
    expect(
      collect([raw('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')]),
    ).toEqual([{ type: "error", message: "Overloaded" }]);
  });

  it("given content with a stop finish reason, yields only the text", () => {
    const chunk = { choices: [{ delta: { content: "Jim fled." }, finish_reason: "stop" }] };
    expect(collect([raw(JSON.stringify(chunk))])).toEqual([{ type: "text", text: "Jim fled." }]);
  });

  it("given a content_filter finish reason, yields one error naming it", () => {
    const chunk = { choices: [{ delta: {}, finish_reason: "content_filter" }] };
    expect(collect([raw(JSON.stringify(chunk))])).toMatchObject([
      { type: "error", message: expect.stringContaining("content_filter") },
    ]);
  });
});

describe("Anthropic event stream", () => {
  const sse = (type: string, data: Record<string, unknown>): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

  it("given a whole message, yields thinking, text, the input with its cache, then the output", () => {
    expect(
      collect([
        sse("message_start", {
          message: {
            usage: {
              input_tokens: 40,
              cache_read_input_tokens: 2000,
              cache_creation_input_tokens: 600,
              output_tokens: 1,
            },
          },
        }),
        sse("content_block_start", { index: 0, content_block: { type: "thinking" } }),
        sse("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "hm" } }),
        sse("content_block_delta", {
          index: 0,
          delta: { type: "signature_delta", signature: "x" },
        }),
        sse("content_block_delta", { index: 1, delta: { type: "text_delta", text: "Jim fled." } }),
        sse("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 90 } }),
        sse("message_stop", {}),
        ": ping\n\n",
      ]),
    ).toEqual([
      { type: "usage", usage: { input: 2640, hit: 2000, write: 600, output: 1 } },
      { type: "reasoning", text: "hm" },
      { type: "text", text: "Jim fled." },
      { type: "usage", usage: { output: 90 } },
    ]);
  });
});
