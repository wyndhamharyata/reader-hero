import { Effect } from "effect";
import {
  Block,
  PARSED_VERSION,
  ParsedBook,
  TocEntry,
  type ImagePlacement,
  type OutlineItem,
  type PageText,
} from "@/domain/book";
import { pageOfLink } from "@/lib/links";
import { relinkBlocks } from "@/lib/relink";
import { buildBlocks } from "./blocks";
import { dropBoilerplate, isSmallBandImage } from "./boilerplate";
import { orderFlow } from "./columns";
import { buildLines } from "./lines";
import type { FlowItem, PageLines } from "./types";

export interface PageExtract {
  readonly text: PageText;
  readonly images: ReadonlyArray<ImagePlacement>;
}

export function isScanned(charCount: number, pageCount: number): boolean {
  return charCount < Math.max(50, pageCount * 40);
}

// The first block on each page. A page with no block reads as the next page.
function firstBlockOfPage(blocks: ReadonlyArray<Block>, pageCount: number): Array<number> {
  const first = Array.from({ length: pageCount + 1 }, () => -1);

  for (const [index, block] of blocks.entries()) {
    if (block.page <= pageCount && first[block.page] === -1) first[block.page] = index;
  }

  let next = -1;

  for (let page = pageCount; page >= 1; page -= 1) {
    if (first[page] !== -1) next = first[page] ?? next;
    else first[page] = next;
  }

  return first;
}

function resolvePageLinks(blocks: Array<Block>, firstByPage: ReadonlyArray<number>): void {
  relinkBlocks(blocks, (href) => {
    const page = pageOfLink(href);

    if (page === null) return "keep";

    const target = firstByPage[page];

    return target === undefined || target < 0 ? null : target;
  });
}

function buildToc(
  outline: ReadonlyArray<OutlineItem>,
  blocks: ReadonlyArray<Block>,
  firstByPage: ReadonlyArray<number>,
): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Set<number>();

  for (const item of outline) {
    const index = firstByPage[item.page];

    if (index === undefined || index < 0 || seen.has(index)) continue;

    seen.add(index);
    entries.push(
      new TocEntry({ title: item.title, page: item.page, blockIndex: index, depth: item.depth }),
    );
  }

  return entries;
}

// Yields to the event loop between stages, so a long book does not stall the import screen.
export function assembleBook(
  pages: ReadonlyArray<PageExtract>,
  outline: ReadonlyArray<OutlineItem>,
): Effect.Effect<ParsedBook> {
  return Effect.gen(function* () {
    const pageLines: PageLines[] = [];

    for (const [index, page] of pages.entries()) {
      pageLines.push({
        page: page.text.page,
        height: page.text.height,
        lines: buildLines(page.text),
      });
      if (index % 32 === 31) yield* Effect.yieldNow;
    }

    const cleaned = dropBoilerplate(pageLines);

    yield* Effect.yieldNow;

    const flow: FlowItem[] = [];

    pages.forEach((page, index) => {
      const lines = cleaned[index]?.lines ?? [];
      const images = page.images.filter((image) => !isSmallBandImage(image, page.text.height));

      flow.push(...orderFlow(lines, images, page.text.width));
    });
    yield* Effect.yieldNow;

    const blocks = buildBlocks(flow).map(
      (raw) =>
        new Block({
          kind: raw.kind,
          level: raw.level,
          text: raw.text,
          page: raw.page,
          imageId: raw.imageId,
          ratio: raw.ratio,
          marks: raw.marks?.map((mark) => ({ ...mark, style: "link" as const })),
        }),
    );

    const firstByPage = firstBlockOfPage(blocks, pages.length);

    resolvePageLinks(blocks, firstByPage);

    const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0);

    return new ParsedBook({
      version: PARSED_VERSION,
      pageCount: pages.length,
      charCount,
      blocks,
      toc: buildToc(outline, blocks, firstByPage),
      figuresThrough: 0,
    });
  });
}
