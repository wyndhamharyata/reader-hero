import { Effect, Layer, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettings, CONSENT_VERSION, type AiUsage } from "@/domain/ai";
import { AiClient } from "@/services/ai-client";
import { SettingsStore } from "@/services/settings-store";

const settings = new AiSettings({
  provider: "anthropic",
  apiKey: "k",
  model: "claude-haiku-5-5",
  consentedAt: 1,
  consentVersion: CONSENT_VERSION,
  linesInContents: true,
  autoSummary: false,
  seriesGrouping: false,
});

const sse = (type: string, data: Record<string, unknown>): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

// `stored` is what Settings holds now. The request carries `settings`, as a running job would.
function run(body: string, stored: AiSettings | null = settings) {
  const added: Array<{ key: string; usage: AiUsage }> = [];
  const fetched = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetched);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const store = Layer.succeed(
    SettingsStore,
    SettingsStore.of({
      changes: () => Stream.empty,
      update: () => Effect.die("not used"),
      aiChanges: () => Stream.empty,
      ai: () => Effect.succeed(stored),
      putAi: () => Effect.die("not used"),
      groupedBooks: () => Effect.die("not used"),
      putGroupedBooks: () => Effect.die("not used"),
      usageChanges: () => Stream.empty,
      addUsage: (key, usage) => Effect.sync(() => void added.push({ key, usage })),
      resetUsage: () => Effect.die("not used"),
    }),
  );
  const text = Effect.runPromise(
    Effect.flatMap(AiClient, (client) =>
      client
        .complete(settings, "system", [{ role: "user", content: "Hi" }], {
          purpose: { stage: "chapter", book: "b1" },
        })
        .pipe(
          Stream.runFold(
            () => "",
            (soFar, delta) => (delta.type === "text" ? soFar + delta.text : soFar),
          ),
        ),
    ).pipe(Effect.provide(AiClient.layer.pipe(Layer.provide(store)))),
  );
  return { text, added, fetched };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI client usage", () => {
  it("given a finished stream, records one tally with the start's input and the end's output", async () => {
    const { text, added } = run(
      sse("message_start", {
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 990, output_tokens: 1 } },
      }) +
        sse("content_block_delta", { delta: { type: "text_delta", text: "Done." } }) +
        sse("message_delta", { usage: { output_tokens: 42 } }),
    );
    expect(await text).toBe("Done.");
    expect(added).toEqual([
      {
        key: "anthropic/claude-haiku-5-5",
        usage: { input: 1000, hit: 990, write: 0, output: 42 },
      },
    ]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("chapter b1"));
  });

  it("given a stream that reports no usage, records nothing", async () => {
    const { text, added } = run(
      sse("content_block_delta", { delta: { type: "text_delta", text: "Done." } }),
    );
    expect(await text).toBe("Done.");
    expect(added).toEqual([]);
  });
});

describe("AI client consent", () => {
  const body = sse("content_block_delta", { delta: { type: "text_delta", text: "Done." } });
  const refused = { _tag: "AiFailure", reason: "no-consent" };

  it("given no stored settings, as after Remove key, sends nothing", async () => {
    const { text, fetched } = run(body, null);
    await expect(text).rejects.toMatchObject(refused);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("given consent to an older text, sends nothing", async () => {
    const { text, fetched } = run(
      body,
      new AiSettings({ ...settings, consentVersion: CONSENT_VERSION - 1 }),
    );
    await expect(text).rejects.toMatchObject(refused);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("given a run that started with another key or provider, sends nothing", async () => {
    for (const stored of [
      new AiSettings({ ...settings, apiKey: "new key" }),
      new AiSettings({ ...settings, provider: "openai" }),
    ]) {
      const { text, fetched } = run(body, stored);
      await expect(text).rejects.toMatchObject(refused);
      expect(fetched).not.toHaveBeenCalled();
    }
  });
});
