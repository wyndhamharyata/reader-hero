import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeImageRecord } from "@/lib/codecs";

describe("decodeImageRecord", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

  it("given a stored row with fractional dimensions, decodes", async () => {
    const decoded = await Effect.runPromise(
      decodeImageRecord({ blob, width: 200.5, height: 100.25 }),
    );
    expect(decoded.width).toBe(200.5);
    expect(decoded.height).toBe(100.25);
  });

  it("given a stored row without a blob, rejects the decode", async () => {
    const outcome = await Effect.runPromise(
      decodeImageRecord({ width: 10, height: 10 }).pipe(
        Effect.map(() => "decoded"),
        Effect.orElseSucceed(() => "rejected"),
      ),
    );
    expect(outcome).toBe("rejected");
  });
});
