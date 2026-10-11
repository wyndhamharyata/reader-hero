import { describe, expect, it } from "vitest";
import { AiSettings, type AiProvider, type PromptPart } from "@/domain/ai";
import { requestOf, writeBilled } from "@/lib/ai-transport";

const settingsFor = (provider: AiProvider, model: string, effort?: string): AiSettings =>
  new AiSettings({
    provider,
    apiKey: "k",
    model,
    ...(effort === undefined ? {} : { effort }),
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

  it("given the model names, bills cache writes from GPT-5.6 on", () => {
    expect(["gpt-5.5", "gpt-5", "o4-mini", "gpt-4.1"].map(writeBilled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(["gpt-5.6", "gpt-6", "openai/gpt-6.1-sol"].map(writeBilled)).toEqual([true, true, true]);
  });
});
