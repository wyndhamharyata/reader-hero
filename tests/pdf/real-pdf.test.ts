import { Effect } from "effect";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import type { PageText } from "@/domain/book";
import { assembleBook } from "@/lib/pdf/assemble";
import { collectImageBoxes } from "@/lib/pdf/image-boxes";
import { toPageText } from "@/lib/pdf/page-text";
import { makePdf } from "../_support/make-pdf";

async function readPages(data: Uint8Array): Promise<PageText[]> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: PageText[] = [];

  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    pages.push(toPageText(number, await page.getTextContent(), page.getViewport({ scale: 1 })));
  }

  await task.destroy();
  return pages;
}

describe("assembleBook with real pdf.js output", () => {
  it("given a real PDF, builds a heading and one merged paragraph", async () => {
    const data = makePdf([
      { text: "Chapter One", size: 24, x: 72, y: 700 },
      {
        text: "This is the first body line and it runs long enough to fill a row.",
        size: 12,
        x: 72,
        y: 660,
      },
      {
        text: "This is the second body line that continues the same paragraph.",
        size: 12,
        x: 72,
        y: 645,
      },
    ]);

    const book = await Effect.runPromise(
      assembleBook(
        (await readPages(data)).map((text) => ({ text, images: [] })),
        [],
      ),
    );

    expect(book.pageCount).toBe(1);
    expect(book.blocks[0]).toMatchObject({ kind: "heading", text: "Chapter One" });

    const paragraph = book.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.text).toContain("first body line");
    expect(paragraph?.text).toContain("second body line");
  });
});

describe("two columns with real pdf.js output", () => {
  it("given columns on shared baselines, reads the left column before the right", async () => {
    const rows = ["alpha", "bravo", "charlie", "delta", "echo"];
    const data = makePdf(
      rows.flatMap((word, row) => [
        { text: `Left ${word} column text runs on`, size: 11, x: 54, y: 700 - row * 14 },
        { text: `Right ${word} column text runs on`, size: 11, x: 324, y: 700 - row * 14 },
      ]),
    );

    const book = await Effect.runPromise(
      assembleBook(
        (await readPages(data)).map((text) => ({ text, images: [] })),
        [],
      ),
    );

    const text = book.blocks.map((block) => block.text).join(" ");
    expect(text.indexOf("Left echo")).toBeLessThan(text.indexOf("Right alpha"));
    expect(text).toContain("Left alpha column text runs on Left bravo");
    expect(text).toContain("Right alpha column text runs on Right bravo");
  });
});

describe("toPageText with real pdf.js output", () => {
  it("given a page box that starts above 0, places text in the page's own box", async () => {
    // The box runs from y 100 to 892, so text drawn at 850 is 750 up a 792-high page.
    const data = makePdf(
      [{ text: "Running head", size: 10, x: 72, y: 850 }],
      undefined,
      [0, 100, 612, 892],
    );
    const [page] = await readPages(data);
    expect(page?.height).toBe(792);
    expect(page?.items[0]?.y).toBeCloseTo(750);
  });
});

describe("collectImageBoxes with real pdf.js output", () => {
  it("given a PDF with an embedded image, records its placement", async () => {
    const data = makePdf([{ text: "figure", size: 12, x: 72, y: 700 }], {
      x: 100,
      y: 400,
      width: 200,
      height: 100,
    });

    const task = pdfjs.getDocument({ data });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const opList = await page.getOperatorList();
    const boxes = collectImageBoxes(
      { fnArray: opList.fnArray, argsArray: opList.argsArray },
      1,
      pdfjs.OPS,
      pdfjs.Util,
    );
    await task.destroy();

    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes[0]).toMatchObject({ x: 100, y: 400, width: 200, height: 100 });
  });
});
