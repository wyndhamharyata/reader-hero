import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ImageRecord } from "@/domain/book";
import { decodeImageRecord } from "@/lib/codecs";

describe("ImageRecord", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

  it("given fractional dimensions, constructs without throwing", () => {
    const record = new ImageRecord({ blob, width: 200.5, height: 100.25 });
    expect(record.width).toBe(200.5);
    expect(record.height).toBe(100.25);
  });

  it("given a stored row with fractional dimensions, decodes", async () => {
    const decoded = await Effect.runPromise(
      decodeImageRecord({ blob, width: 200.5, height: 100.25 }),
    );
    expect(decoded.width).toBe(200.5);
    expect(decoded.height).toBe(100.25);
  });
});
