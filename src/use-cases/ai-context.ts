import type { ParsedBook } from "@/domain/book";

export interface Chapter {
  readonly heading: string;
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

const words = (text: string): number => text.split(" ").length;

export function spanText(parsed: ParsedBook, start: number, end: number): string {
  return parsed.blocks
    .slice(start, end)
    .filter((block) => block.kind !== "image")
    .map((block) => block.text)
    .join("\n\n");
}

// At least 200 words, so a part title or a copyright page is not a chapter; long spans are cut to fit a request.
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
