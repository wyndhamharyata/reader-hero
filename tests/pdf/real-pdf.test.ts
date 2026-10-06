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

    const book = assembleBook(
      (await readPages(data)).map((text) => ({ text, images: [] })),
      [],
    );

    expect(book.pageCount).toBe(1);
    expect(book.blocks[0]).toMatchObject({ kind: "heading", text: "Chapter One" });

    const paragraph = book.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.text).toContain("first body line");
    expect(paragraph?.text).toContain("second body line");
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
