import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodeStoredPages } from "@/lib/codecs";

const pages = [
  {
    page: 1,
    width: 612,
    height: 792,
    items: [
      {
        str: "A linked line",
        x: 40,
        y: 700,
        width: 100,
        height: 12,
        fontSize: 12,
        fontFamily: "serif",
        hasEOL: false,
      },
    ],
    links: [
      { left: 40, right: 140, bottom: 698, top: 712, target: { url: "https://example.com" } },
      { left: 40, right: 140, bottom: 678, top: 692, target: { page: 2 } },
    ],
  },
];

describe("StoredPages", () => {
  it("given pages with links, decodes each target", async () => {
    const decoded = await Effect.runPromise(decodeStoredPages(pages));

    expect(decoded[0]?.links).toEqual(pages[0]?.links);
  });
});
