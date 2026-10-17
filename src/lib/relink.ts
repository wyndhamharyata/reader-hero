import { Block } from "@/domain/book";
import { blockLink } from "@/lib/links";

// A resolved place in the book, or "keep" for a link that does not point inside it.
export type LinkResolution = "keep" | number | null;

export function relinkBlocks(
  blocks: Array<Block>,
  resolve: (href: string) => LinkResolution,
): void {
  for (const [index, block] of blocks.entries()) {
    if (block.marks === undefined) continue;

    const marks: Array<NonNullable<Block["marks"]>[number]> = [];
    let changed = false;

    for (const mark of block.marks) {
      if (mark.href === undefined) {
        marks.push(mark);
        continue;
      }

      const target = resolve(mark.href);

      if (target === "keep") {
        marks.push(mark);
        continue;
      }

      changed = true;

      if (target !== null) marks.push({ ...mark, href: blockLink(target) });
    }

    if (changed)
      blocks[index] = new Block({ ...block, marks: marks.length > 0 ? marks : undefined });
  }
}
