import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeReadingProgress } from "@/lib/codecs";

describe("decodeReadingProgress", () => {
  it("given a record from an older build, leaves Finished unset", async () => {
    const progress = await Effect.runPromise(
      decodeReadingProgress({ blockIndex: 24, percent: 0.24, updatedAt: 5, furthest: 24 }),
    );

    expect(progress.finished).toBeUndefined();
  });
});
