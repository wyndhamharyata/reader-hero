import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeBookPrefs, decodeReaderSettings } from "@/lib/codecs";

describe("decodeReaderSettings", () => {
  it("given a stored sepia theme, opens it as light and keeps the other settings", async () => {
    const decoded = await Effect.runPromise(
      decodeReaderSettings({ theme: "rhsepia", font: "sans", fontSize: 20, lineHeight: 1.4 }),
    );

    expect(decoded.theme).toBe("rhlight");
    expect(decoded.font).toBe("sans");
    expect(decoded.temperature).toBe(0);
  });

  it("given a book's sepia choice, opens it as light", async () => {
    const decoded = await Effect.runPromise(decodeBookPrefs({ theme: "rhsepia", fontSize: 22 }));

    expect(decoded.theme).toBe("rhlight");
    expect(decoded.fontSize).toBe(22);
  });
});
