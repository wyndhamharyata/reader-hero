import type { BookKind, Summary } from "@/domain/ai";
import type { ParsedBook } from "@/domain/book";

export interface Passage {
  readonly text: string;
  readonly heading: string;
  readonly page: number;
}

export interface Chapter {
  readonly heading: string;
  readonly page: number;
  readonly start: number;
  readonly end: number;
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

export function spanText(parsed: ParsedBook, start: number, end: number): string {
  return parsed.blocks
    .slice(start, end)
    .filter((block) => block.kind !== "image")
    .map((block) => block.text)
    .join("\n\n");
}

// The spans the summary covers, in reading order: one per contents entry (or heading block when
// there is no contents) that has at least 200 words, so a part title or a copyright page is not a
// chapter. A span over 10,000 words is cut into pieces of 8,000, and a book with neither entries
// nor headings is cut the same way, each piece named by its first page.
export function chapters(parsed: ParsedBook): ReadonlyArray<Chapter> {
  const entries =
    parsed.toc.length > 0
      ? parsed.toc.map((entry) => ({ title: entry.title, at: entry.blockIndex }))
      : parsed.blocks.flatMap((block, at) =>
          block.kind === "heading" ? [{ title: block.text, at }] : [],
        );
  const kept = entries.filter((entry, position) => {
    const end = entries[position + 1]?.at ?? parsed.blocks.length;
    return words(spanText(parsed, entry.at, end)) >= 200;
  });
  const spans = kept.length === 0 ? [{ title: "", at: 0 }] : kept;
  const result: Array<Chapter> = [];
  spans.forEach((span) => {
    const end =
      (kept.length === 0 ? undefined : entries.find((entry) => entry.at > span.at)?.at) ??
      parsed.blocks.length;
    const total = words(spanText(parsed, span.at, end));
    const name = (at: number): string => {
      const page = parsed.blocks[at]?.page ?? 1;
      if (span.title === "") return `Page ${page}`;
      return at === span.at ? span.title : `${span.title} · page ${page}`;
    };
    if (total <= 10_000) {
      result.push({
        heading: name(span.at),
        page: parsed.blocks[span.at]?.page ?? 1,
        start: span.at,
        end,
      });
      return;
    }
    let start = span.at;
    let count = 0;
    for (let at = span.at; at < end; at += 1) {
      count += words(parsed.blocks[at]?.text ?? "");
      if (count < 8_000 && at < end - 1) continue;
      result.push({
        heading: name(start),
        page: parsed.blocks[start]?.page ?? 1,
        start,
        end: at + 1,
      });
      start = at + 1;
      count = 0;
    }
  });
  return result;
}

// The last `limit` words up to and including the top block. Nothing after the position is read.
export function recentPages(parsed: ParsedBook, index: number, limit = 4000): Passage {
  let start = index;
  let count = 0;
  while (start > 0 && count < limit) {
    count += words(parsed.blocks[start]?.text ?? "");
    start -= 1;
  }
  return {
    text: spanText(parsed, start, index + 1),
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
    text: spanText(parsed, chapter.start, end),
    heading: chapter.heading,
    page: parsed.blocks[index]?.page ?? 1,
  };
}

// The summary's paragraphs for the chapters before the position, then the text from the first
// chapter the summary does not cover up to the position. With a current summary that text is the
// current chapter alone.
export function readSoFar(parsed: ParsedBook, index: number, summary: Summary | null): Passage {
  const list = chapters(parsed);
  const before = list.filter((chapter) => chapter.end <= index).length;
  const covered = Math.min(summary?.chapters.length ?? 0, before);
  const paragraphs = (summary?.chapters ?? [])
    .slice(0, covered)
    .map((chapter) => `${chapter.heading}\n${chapter.paragraph}`)
    .join("\n\n");
  const from = list[covered]?.start ?? index + 1;
  const text = spanText(parsed, Math.min(from, index + 1), index + 1);
  return {
    text: paragraphs === "" ? text : `Summary so far:\n\n${paragraphs}\n\nSince then:\n\n${text}`,
    heading: chapterAt(parsed, index).heading,
    page: parsed.blocks[index]?.page ?? 1,
  };
}
