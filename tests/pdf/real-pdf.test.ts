import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import type { PageText, RawTextItem } from "@/domain/book";
import { assembleBook } from "@/lib/pdf/assemble";
import { makePdf } from "../_support/make-pdf";

async function readPages(data: Uint8Array): Promise<PageText[]> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: PageText[] = [];

  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: RawTextItem[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const t = item.transform as number[];
      const size = Math.hypot(Number(t[2] ?? 0), Number(t[3] ?? 0)) || item.height;
      items.push({
        str: item.str,
        x: Number(t[4] ?? 0),
        y: Number(t[5] ?? 0),
        width: item.width,
        height: item.height,
        fontSize: size,
        fontFamily: content.styles[item.fontName]?.fontFamily ?? "",
        hasEOL: item.hasEOL,
      });
    }

    pages.push({ page: number, width: viewport.width, height: viewport.height, items });
  }

  await task.destroy();
  return pages;
}

describe("assembleBook with real pdf.js output", () => {
  it("given a real PDF, builds a heading and one merged paragraph", async () => {
    const data = makePdf([
      { text: "Chapter One", size: 24, x: 72, y: 700 },
      { text: "This is the first body line and it runs long enough to fill a row.", size: 12, x: 72, y: 660 },
      { text: "This is the second body line that continues the same paragraph.", size: 12, x: 72, y: 645 },
    ]);

    const book = assembleBook(await readPages(data), []);

    expect(book.pageCount).toBe(1);
    expect(book.blocks[0]).toMatchObject({ kind: "heading", text: "Chapter One" });

    const paragraph = book.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.text).toContain("first body line");
    expect(paragraph?.text).toContain("second body line");
  });
});
