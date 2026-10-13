import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettings, type AiProvider, type PromptPart } from "@/domain/ai";
import { complete, models, requestOf, writeBilled } from "@/lib/ai-transport";

const settingsFor = (
  provider: AiProvider,
  model: string,
  effort?: string,
  reasoningOff?: boolean,
): AiSettings =>
  new AiSettings({
    provider,
    apiKey: "k",
    model,
    ...(effort === undefined ? {} : { effort }),
    ...(reasoningOff === undefined ? {} : { reasoningOff }),
    linesInContents: true,
    autoSummary: false,
    seriesGrouping: false,
  });

const system = "You summarise one chapter.";
const split: ReadonlyArray<PromptPart> = [
  { text: "Book: Salt Memory.\n" },
  { text: "Text:\nThe tide came in.", cache: true },
  { text: "\nPrevious summary: none." },
];
const sent = (provider: AiProvider, model: string, effort?: string) =>
  requestOf(settingsFor(provider, model, effort), system, [{ role: "user", content: split }], {
    purpose: { stage: "chapter", book: "b3" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request per provider", () => {
  it("given DeepSeek, sends plain strings, asks for usage, and turns thinking off", () => {
    const { path, body } = sent("deepseek", "deepseek-chat");
    expect(path).toBe("/chat/completions");
    expect(body.messages).toEqual([
      { role: "system", content: system },
      {
        role: "user",
        content: "Book: Salt Memory.\nText:\nThe tide came in.\nPrevious summary: none.",
      },
    ]);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("prompt_cache_key");
  });

  it("given Gemini, sends plain strings with no cache fields", () => {
    const { body } = sent("gemini", "gemini-2.5-flash");
    expect(typeof (body.messages as Array<{ content: unknown }>)[1]?.content).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream", "stream_options"]);
  });

  it("given an OpenAI model before 5.6, keys the cache by book and leaves breakpoints to OpenAI", () => {
    const { body } = sent("openai", "gpt-5.5");
    expect(body.prompt_cache_key).toBe("reader-hero:b3");
    expect(body).not.toHaveProperty("prompt_cache_options");
    expect(typeof (body.messages as Array<{ content: unknown }>)[1]?.content).toBe("string");
  });

  it("given GPT-5.6 or later, caches only the marked prefix", () => {
    const { body } = sent("openai", "gpt-6.1-sol");
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect((body.messages as Array<{ content: unknown }>)[1]?.content).toEqual([
      {
        type: "text",
        text: "Book: Salt Memory.\nText:\nThe tide came in.",
        prompt_cache_breakpoint: { mode: "explicit" },
      },
      { type: "text", text: "\nPrevious summary: none." },
    ]);
  });

  it("given GPT-5.6 or later with no mark, sends explicit mode so nothing is written", () => {
    const { body } = requestOf(settingsFor("openai", "gpt-5.6"), system, [
      { role: "user", content: "One chapter, sent once." },
    ]);
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect((body.messages as Array<{ content: unknown }>)[1]?.content).toBe(
      "One chapter, sent once.",
    );
  });

  it("given OpenRouter, keeps the session on one provider and marks the prefix for it", () => {
    const { body } = sent("openrouter", "anthropic/claude-sonnet-5.5");
    expect(body.session_id).toBe("reader-hero:b3");
    expect((body.messages as Array<{ content: unknown }>)[1]?.content).toEqual([
      {
        type: "text",
        text: "Book: Salt Memory.\nText:\nThe tide came in.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "\nPrevious summary: none." },
    ]);
    expect(sent("openrouter", "openai/gpt-6.1-sol").body.prompt_cache_options).toEqual({
      mode: "explicit",
    });
  });

  it("given OpenRouter with thinking allowed off, turns thinking off for Off", () => {
    const { body } = requestOf(settingsFor("openrouter", "x", undefined, true), system, [
      { role: "user", content: "One chapter." },
    ]);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("given OpenRouter without that answer, sends no reasoning field", () => {
    const { body } = requestOf(settingsFor("openrouter", "x"), system, [
      { role: "user", content: "One chapter." },
    ]);
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("given OpenRouter with an effort level, sends the effort and no disable", () => {
    const { body } = requestOf(settingsFor("openrouter", "x", "low", true), system, [
      { role: "user", content: "One chapter." },
    ]);
    expect(body.reasoning_effort).toBe("low");
    expect(body.reasoning).toBeUndefined();
  });

  it("given Anthropic, uses its own API with the effort and a breakpoint on the marked prefix", () => {
    const { path, body } = sent("anthropic", "claude-sonnet-5-5", "medium");
    expect(path).toBe("/messages");
    expect(body.system).toBe(system);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Book: Salt Memory.\nText:\nThe tide came in.",
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: "\nPrevious summary: none." },
        ],
      },
    ]);
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("stream_options");
    expect(body).not.toHaveProperty("thinking");
  });

  it("given Anthropic with more than 4 marks, keeps the latest 4", () => {
    const marks: ReadonlyArray<PromptPart> = ["a", "b", "c", "d", "e"].map((text) => ({
      text,
      cache: true,
    }));
    const { body } = requestOf(settingsFor("anthropic", "claude-haiku-5-5"), system, [
      { role: "user", content: marks },
    ]);
    const blocks = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]
      ?.content;
    expect(blocks?.map((block) => "cache_control" in block)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it("given an OpenAI-compatible provider, sends plain strings with no provider fields", () => {
    const { body } = sent("compatible", "llama");
    // Off asks the provider for no thinking in the OpenAI way, which OpenCode maps for DeepSeek.
    expect(Object.keys(body).sort()).toEqual([
      "messages",
      "model",
      "reasoning_effort",
      "stream",
      "stream_options",
    ]);
    expect(body.reasoning_effort).toBe("none");
    expect(sent("compatible", "llama", "low").body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning");
  });

  it("given an OpenAI-compatible provider, asks the relay with the target URL", async () => {
    const mock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: "m1" }] })),
    );
    vi.stubGlobal("fetch", mock);
    const settings = new AiSettings({
      ...settingsFor("compatible", "m1"),
      baseUrl: "https://api.groq.com/openai/v1/",
    });
    const list = await Effect.runPromise(models(settings));
    const request = mock.mock.calls[0];
    expect(request?.[0]).toBe("/relay");
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("x-relay-target")).toBe("https://api.groq.com/openai/v1/models");
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(list.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("given the model list, marks only the models the provider says may skip thinking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: "a", supported_parameters: ["reasoning"], reasoning: { mandatory: false } },
                { id: "b", supported_parameters: ["reasoning"], reasoning: { mandatory: true } },
                { id: "c", supported_parameters: ["reasoning"] },
              ],
            }),
          ),
        ),
      ),
    );
    const list = await Effect.runPromise(models(settingsFor("openrouter", "x")));
    expect(list).toEqual([
      { id: "a", efforts: ["low", "medium", "high"], reasoningOff: true },
      { id: "b", efforts: ["low", "medium", "high"] },
      { id: "c", efforts: ["low", "medium", "high"] },
    ]);
  });

  it("given the model names, bills cache writes from GPT-5.6 on", () => {
    expect(["gpt-5.5", "gpt-5", "o4-mini", "gpt-4.1"].map(writeBilled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(["gpt-5.6", "gpt-6", "openai/gpt-6.1-sol"].map(writeBilled)).toEqual([true, true, true]);
  });

  it("given a provider that fails after its 200, fails the stream with its reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response('data: {"error":{"message":"Rate limit reached"}}\n\ndata: [DONE]\n\n', {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runCollect(
          complete(settingsFor("gemini", "gemini-3.5-flash-lite"), system, [
            { role: "user", content: "One chapter." },
          ]),
        ),
      ),
    );
    expect(failure.message).toContain("Rate limit reached");
  });
});
