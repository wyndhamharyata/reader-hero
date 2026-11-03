import type { ParsedBook } from "@/domain/book";

export interface Chapter {
  readonly heading: string;
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

const words = (text: string): number => text.split(" ").length;

// The count words(spanText(...)) gives, without copying the text of every chapter.
function spanWords(parsed: ParsedBook, start: number, end: number): number {
  let spaces = 0;

  for (let at = start; at < end; at += 1) {
    const block = parsed.blocks[at];

    if (block === undefined || block.kind === "image") continue;

    for (
      let index = block.text.indexOf(" ");
      index !== -1;
      index = block.text.indexOf(" ", index + 1)
    ) {
      spaces += 1;
    }
  }

  return spaces + 1;
}

export function spanText(parsed: ParsedBook, start: number, end: number): string {
  return parsed.blocks
    .slice(start, end)
    .filter((block) => block.kind !== "image")
    .map((block) => block.text)
    .join("\n\n");
}

// At least 200 words, so a part title or a copyright page is not a chapter. Long spans are cut to fit a request.
export function chapters(parsed: ParsedBook): ReadonlyArray<Chapter> {
  const entries =
    parsed.toc.length > 0
      ? parsed.toc.map((entry) => ({ title: entry.title, at: entry.blockIndex }))
      : parsed.blocks.flatMap((block, at) =>
          block.kind === "heading" ? [{ title: block.text, at }] : [],
        );
  const ordered = [...entries].sort((a, b) => a.at - b.at);
  const kept = ordered.filter((entry, position) => {
    const end = ordered[position + 1]?.at ?? parsed.blocks.length;
    return spanWords(parsed, entry.at, end) >= 200;
  });
  const spans = kept.length === 0 ? [{ title: "", at: 0 }] : kept;
  const result: Array<Chapter> = [];

  spans.forEach((span, position) => {
    const end = spans[position + 1]?.at ?? parsed.blocks.length;
    const total = spanWords(parsed, span.at, end);
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
