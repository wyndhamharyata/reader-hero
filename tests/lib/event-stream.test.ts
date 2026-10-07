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
});
