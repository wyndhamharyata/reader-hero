import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { AiSettings, CONSENT_VERSION } from "@/domain/ai";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { saveAiSettings } from "@/use-cases/ai-settings";

const allowed = new AiSettings({
  provider: "anthropic",
  apiKey: "k",
  model: "claude-haiku-5-5",
  consentedAt: 1,
  consentVersion: CONSENT_VERSION,
  linesInContents: true,
  autoSummary: false,
  seriesGrouping: false,
});

// Saves `next` over `current` and reports whether the running jobs were stopped first.
async function save(current: AiSettings | null, next: AiSettings | null) {
  const state = { stoppedAll: 0, saved: undefined as AiSettings | null | undefined };
  const settings = Layer.succeed(
    SettingsStore,
    SettingsStore.of({
      changes: () => Stream.empty,
      update: () => Effect.die("not used"),
      aiChanges: () => Stream.empty,
      ai: () => Effect.succeed(current),
      putAi: (value) =>
        Effect.sync(() => {
          state.saved = value;
        }),
      groupedBooks: () => Effect.die("not used"),
      putGroupedBooks: () => Effect.die("not used"),
      usageChanges: () => Stream.empty,
      addUsage: () => Effect.die("not used"),
      resetUsage: () => Effect.die("not used"),
    }),
  );
  const jobs = Layer.succeed(
    SummaryJobs,
    SummaryJobs.of({
      state: () => Stream.empty,
      start: () => Effect.die("not used"),
      startSeries: () => Effect.die("not used"),
      startRebuild: () => Effect.die("not used"),
      stop: () => Effect.die("not used"),
      stopAll: () =>
        Effect.sync(() => {
          state.stoppedAll += 1;
        }),
    }),
  );
  await Effect.runPromise(saveAiSettings(next).pipe(Effect.provide(Layer.merge(settings, jobs))));
  return state;
}

describe("saveAiSettings", () => {
  it("given Remove key, stops every run before the key goes", async () => {
    const state = await save(allowed, null);
    expect(state.stoppedAll).toBe(1);
    expect(state.saved).toBeNull();
  });

  it("given another provider or key, stops every run", async () => {
    expect(
      (await save(allowed, new AiSettings({ ...allowed, provider: "openai" }))).stoppedAll,
    ).toBe(1);
    expect((await save(allowed, new AiSettings({ ...allowed, apiKey: "other" }))).stoppedAll).toBe(
      1,
    );
  });

  it("given settings without the current consent, stops every run", async () => {
    const state = await save(allowed, new AiSettings({ ...allowed, consentedAt: undefined }));
    expect(state.stoppedAll).toBe(1);
  });

  it("given a toggle or a new model with the same provider and key, lets the runs go on", async () => {
    expect(
      (await save(allowed, new AiSettings({ ...allowed, autoSummary: true }))).stoppedAll,
    ).toBe(0);
    expect((await save(allowed, new AiSettings({ ...allowed, model: "other" }))).stoppedAll).toBe(
      0,
    );
  });

  it("given consent just allowed, lets the run it starts go on", async () => {
    const before = new AiSettings({
      ...allowed,
      consentedAt: undefined,
      consentVersion: undefined,
    });
    expect((await save(before, allowed)).stoppedAll).toBe(0);
  });
});
