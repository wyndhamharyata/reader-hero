import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAiSettings, decodeGroupedBooks } from "@/lib/codecs";

describe("decodeAiSettings", () => {
  it("given a record from before Series grouping, keeps the key and the old consent, with grouping off", async () => {
    const decoded = await Effect.runPromise(
      decodeAiSettings({ provider: "deepseek", apiKey: "k", model: "flash", consentedAt: 5 }),
    );

    expect(decoded.apiKey).toBe("k");
    expect(decoded.consentedAt).toBe(5);
    expect(decoded.consentVersion).toBeUndefined();
    expect(decoded.seriesGrouping).toBe(false);
    expect(decoded.autoSummary).toBe(false);
  });
});

describe("decodeGroupedBooks", () => {
  it("given the stored ids, returns them, and rejects a record of another shape", async () => {
    const decoded = await Effect.runPromise(decodeGroupedBooks({ ids: ["b1", "b2"] }));
    const broken = await Effect.runPromise(Effect.flip(decodeGroupedBooks({ ids: "b1" })));

    expect(decoded.ids).toEqual(["b1", "b2"]);
    expect(broken).toBeDefined();
  });
});
