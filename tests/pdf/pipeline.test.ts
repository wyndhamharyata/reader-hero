import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { PageText, RawTextItem } from "@/domain/book";
import { assembleBook, isScanned } from "@/lib/pdf/assemble";
import { buildBlocks } from "@/lib/pdf/blocks";
import { dropBoilerplate } from "@/lib/pdf/boilerplate";
import { orderFlow } from "@/lib/pdf/columns";
import { buildLines } from "@/lib/pdf/lines";
import type { FlowItem, TextLine } from "@/lib/pdf/types";

const item = (
  str: string,
  x: number,
  y: number,
  overrides: Partial<RawTextItem> = {},
): RawTextItem => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 10,
  fontSize: 10,
  fontFamily: "serif",
  hasEOL: false,
  ...overrides,
});

const page = (number: number, items: RawTextItem[], width = 400, height = 800): PageText => ({
  page: number,
  width,
  height,
  items,
});

const line = (text: string, x: number, y: number, width: number, fontSize = 10): TextLine => ({
  page: 1,
  text,
  x,
  y,
  width,
  fontSize,
  fontFamily: "serif",
});

const text = (value: TextLine): FlowItem => ({ type: "text", line: value });

describe("buildLines", () => {
  it("given items on one baseline, joins them into a line in reading order", () => {
    const lines = buildLines(
      page(1, [item("World", 40, 100), item("Hello", 0, 100)]),
    );

    expect(lines.map((entry) => entry.text)).toEqual(["Hello World"]);
  });

  it("given items on separate baselines, keeps them apart", () => {
    const lines = buildLines(page(1, [item("First", 0, 100), item("Second", 0, 80)]));

    expect(lines.map((entry) => entry.text)).toEqual(["First", "Second"]);
  });
});

const order = (lines: ReadonlyArray<TextLine>): string[] =>
  orderFlow(lines, [], 400).map((item) => (item.type === "text" ? item.line.text : ""));

describe("orderFlow", () => {
  it("given two clean columns, reads the left column before the right", () => {
    const lines = [
      line("L1", 0, 700, 180),
      line("R1", 220, 700, 180),
      line("L2", 0, 680, 180),
      line("R2", 220, 680, 180),
      line("L3", 0, 660, 180),
      line("R3", 220, 660, 180),
    ];

    expect(order(lines)).toEqual(["L1", "L2", "L3", "R1", "R2", "R3"]);
  });

  it("given a full-width line, falls back to vertical order", () => {
    const lines = [
      line("Wide", 0, 720, 400),
      line("L1", 0, 700, 180),
      line("R1", 220, 700, 180),
      line("L2", 0, 680, 180),
      line("R2", 220, 680, 180),
      line("L3", 0, 660, 180),
    ];

    expect(order(lines)).toEqual(["Wide", "L1", "R1", "L2", "R2", "L3"]);
  });
});

describe("buildBlocks", () => {
  it("given a full line followed by a full line, joins them into one paragraph", () => {
    const blocks = buildBlocks([text(line("first half", 0, 700, 200)), text(line("second half", 0, 688, 200))]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe("first half second half");
  });

  it("given a hyphenated line break, rejoins the word without a space", () => {
    const blocks = buildBlocks([text(line("inter-", 0, 700, 200)), text(line("national law", 0, 688, 200))]);

    expect(blocks[0]?.text).toBe("international law");
  });

  it("given a larger font, marks the line as a level-one heading", () => {
    const blocks = buildBlocks([
      text(line("Chapter One", 0, 700, 200, 20)),
      text(line("body text continues here", 0, 660, 200)),
      text(line("and more body text follows", 0, 640, 200)),
    ]);

    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "Chapter One" });
  });

  it("given a short line, starts a new paragraph", () => {
    const blocks = buildBlocks([text(line("A short line.", 0, 700, 60)), text(line("New paragraph here", 0, 680, 200))]);

    expect(blocks).toHaveLength(2);
  });
});

describe("dropBoilerplate", () => {
  it("given a running header on every page, removes it", () => {
    const pages = [1, 2, 3, 4].map((number) =>
      ({
        page: number,
        height: 800,
        lines: [line("Journal of Tests", 0, 790, 120), line(`body ${number}`, 0, 400, 200)],
      }),
    );
    const cleaned = dropBoilerplate(pages);

    expect(cleaned.flatMap((entry) => entry.lines.map((l) => l.text))).toEqual([
      "body 1",
      "body 2",
      "body 3",
      "body 4",
    ]);
  });

  it("given a page number in the footer, removes it", () => {
    const pages = [
      { page: 1, height: 800, lines: [line("Page 1", 0, 5, 30), line("body", 0, 400, 200)] },
    ];
    const cleaned = dropBoilerplate(pages);

    expect(cleaned[0]?.lines.map((l) => l.text)).toEqual(["body"]);
  });
});

describe("isScanned", () => {
  it("given a page with no extractable text, reports scanned", () => {
    expect(isScanned(10, 5)).toBe(true);
  });

  it("given a page with body text, reports not scanned", () => {
    expect(isScanned(5000, 5)).toBe(false);
  });
});

describe("assembleBook", () => {
  it("given a heading and body across pages, builds ordered blocks", async () => {
    const book = await Effect.runPromise(
      assembleBook(
        [
          {
            text: page(1, [
              item("The Title", 0, 750, { fontSize: 20 }),
              item("body text on the first page that runs long", 0, 700),
            ]),
            images: [],
          },
          {
            text: page(2, [item("more body text on the second page", 0, 750)]),
            images: [],
          },
        ],
        [],
      ),
    );

    expect(book.pageCount).toBe(2);
    expect(book.blocks[0]).toMatchObject({ kind: "heading", text: "The Title", page: 1 });
    expect(book.charCount).toBeGreaterThan(0);
  });

  it("given an image between two paragraphs, places an image block between them", async () => {
    const book = await Effect.runPromise(
      assembleBook(
        [
          {
            text: page(1, [item("before the figure", 0, 700), item("after the figure", 0, 600)]),
            images: [{ id: "1-0", page: 1, x: 100, y: 650, width: 200, height: 30 }],
          },
        ],
        [],
      ),
    );

    expect(book.blocks.map((block) => block.kind)).toEqual(["paragraph", "image", "paragraph"]);
    expect(book.blocks[1]?.imageId).toBe("1-0");
  });
});
