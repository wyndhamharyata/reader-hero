import {
  Block,
  PARSED_VERSION,
  ParsedBook,
  TocEntry,
  type OutlineItem,
  type PageText,
} from "@/domain/book";
import { buildBlocks } from "./blocks";
import { dropBoilerplate } from "./boilerplate";
import { orderPageLines } from "./columns";
import { buildLines } from "./lines";
import type { PageLines } from "./types";

export function isScanned(charCount: number, pageCount: number): boolean {
  return charCount < Math.max(50, pageCount * 40);
}

function buildToc(outline: ReadonlyArray<OutlineItem>, blocks: ReadonlyArray<Block>): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Set<number>();

  for (const item of outline) {
    const index = blocks.findIndex((block) => block.page >= item.page);
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    entries.push(
      new TocEntry({ title: item.title, page: item.page, blockIndex: index, depth: item.depth }),
    );
  }

  return entries;
}

export function assembleBook(
  pages: ReadonlyArray<PageText>,
  outline: ReadonlyArray<OutlineItem>,
): ParsedBook {
  const pageLines: PageLines[] = pages.map((page) => ({
    page: page.page,
    height: page.height,
    lines: orderPageLines(buildLines(page), page.width),
  }));

  const lines = dropBoilerplate(pageLines).flatMap((page) => page.lines);
  const blocks = buildBlocks(lines).map(
    (raw) => new Block({ kind: raw.kind, level: raw.level, text: raw.text, page: raw.page }),
  );
  const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0);

  return new ParsedBook({
    version: PARSED_VERSION,
    pageCount: pages.length,
    charCount,
    blocks,
    toc: buildToc(outline, blocks),
  });
}
