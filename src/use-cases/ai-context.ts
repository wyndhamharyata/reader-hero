import type { BookKind } from "@/domain/ai";
import type { ParsedBook } from "@/domain/book";

export interface Passage {
  readonly text: string;
  readonly heading: string;
  readonly page: number;
}

// The chapter that holds `index`: the span between the contents entry at or before it and the next
// one. A book with no contents uses its heading blocks the same way.
export function chapterAt(
  parsed: ParsedBook,
  index: number,
): { readonly heading: string; readonly start: number; readonly end: number } {
  const entries =
    parsed.toc.length > 0
      ? parsed.toc.map((entry) => ({ title: entry.title, at: entry.blockIndex }))
      : parsed.blocks.flatMap((block, at) =>
          block.kind === "heading" ? [{ title: block.text, at }] : [],
        );
  let current = { title: "", at: 0 };
  let end = parsed.blocks.length;
  for (const entry of entries) {
    if (entry.at <= index) current = entry;
    else {
      end = entry.at;
      break;
    }
  }
  return { heading: current.title, start: current.at, end };
}

const words = (text: string): number => text.split(" ").length;

const join = (parsed: ParsedBook, start: number, end: number): string =>
  parsed.blocks
    .slice(start, end)
    .filter((block) => block.kind !== "image")
    .map((block) => block.text)
    .join("\n\n");

// The last `limit` words up to and including the top block. Nothing after the position is read.
export function recentPages(parsed: ParsedBook, index: number, limit = 4000): Passage {
  let start = index;
  let count = 0;
  while (start > 0 && count < limit) {
    count += words(parsed.blocks[start]?.text ?? "");
    start -= 1;
  }
  return {
    text: join(parsed, start, index + 1),
    heading: chapterAt(parsed, index).heading,
    page: parsed.blocks[index]?.page ?? 1,
  };
}

// The current chapter. For a story it ends at the position, which is the gate; for a reference
// document it is the whole section.
export function chapterText(parsed: ParsedBook, index: number, kind: BookKind): Passage {
  const chapter = chapterAt(parsed, index);
  const end = kind === "story" ? index + 1 : chapter.end;
  return {
    text: join(parsed, chapter.start, end),
    heading: chapter.heading,
    page: parsed.blocks[index]?.page ?? 1,
  };
}
