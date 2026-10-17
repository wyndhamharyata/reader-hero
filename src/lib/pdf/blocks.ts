import { median, type FlowItem, type LinkRange, type RawBlock, type TextLine } from "./types";

interface Paragraph {
  kind: "paragraph";
  level: number;
  text: string;
  page: number;
  marks: Array<LinkRange>;
}

function startParagraph(line: TextLine): Paragraph {
  return {
    kind: "paragraph",
    level: 0,
    text: line.text,
    page: line.page,
    marks: [...(line.marks ?? [])],
  };
}

const HEADING_LEVELS: ReadonlyArray<{ readonly ratio: number; readonly level: number }> = [
  { ratio: 1.8, level: 1 },
  { ratio: 1.35, level: 2 },
  { ratio: 1.15, level: 3 },
];

const endsSentence = (text: string): boolean => /[.!?:;]["')\]]?$/.test(text);
// Runs on the whole paragraph so far, so it must not scan it: a regex here made long paragraphs quadratic.
const endsHyphen = (text: string): boolean => {
  const before = text.charAt(text.length - 2);
  return text.endsWith("-") && before >= "a" && before <= "z";
};

function headingLevel(line: TextLine, bodySize: number): number {
  if (bodySize <= 0) return 0;

  const ratio = line.fontSize / bodySize;

  for (const entry of HEADING_LEVELS) {
    if (ratio >= entry.ratio) return entry.level;
  }

  return 0;
}

function joinLine(text: string, next: string): { readonly text: string; readonly offset: number } {
  if (endsHyphen(text) && /^[a-z]/.test(next)) {
    return { text: `${text.slice(0, -1)}${next}`, offset: -1 };
  }

  return { text: `${text} ${next}`, offset: 1 };
}

function startsNewParagraph(
  line: TextLine,
  previous: TextLine,
  bodySize: number,
  bodyWidth: number,
  leftEdge: number,
): boolean {
  if (previous.y - line.y > previous.fontSize * 1.7) return true;
  if (previous.width < bodyWidth * 0.62) return true;
  if (line.x > leftEdge + bodySize * 0.8 && endsSentence(previous.text)) return true;

  return false;
}

export function buildBlocks(items: ReadonlyArray<FlowItem>): ReadonlyArray<RawBlock> {
  if (items.length === 0) return [];

  const textLines = items.flatMap((item) => (item.type === "text" ? [item.line] : []));
  const bodySize = median(textLines.map((line) => line.fontSize));
  const bodyWidth = median(textLines.map((line) => line.width));
  // A loop, not a spread: a long book's lines pass WebKit's limit on arguments.
  const leftEdge = textLines.reduce(
    (edge, line) => Math.min(edge, line.x),
    textLines.length > 0 ? Number.POSITIVE_INFINITY : 0,
  );

  const blocks: RawBlock[] = [];
  let current: Paragraph | null = null;
  let previous: TextLine | null = null;

  const flush = (): void => {
    if (current === null) return;

    const marks = current.marks.filter((mark) => mark.end > mark.start);

    blocks.push({ ...current, marks: marks.length > 0 ? marks : undefined });
    current = null;
  };

  for (const item of items) {
    if (item.type === "image") {
      flush();
      blocks.push({
        kind: "image",
        level: 0,
        text: "",
        page: item.image.page,
        imageId: item.image.id,
        ratio: item.image.height > 0 ? item.image.width / item.image.height : undefined,
      });
      previous = null;
      continue;
    }

    const line = item.line;
    const level = headingLevel(line, bodySize);

    if (level > 0) {
      flush();
      blocks.push({ kind: "heading", level, text: line.text, page: line.page, marks: line.marks });
      previous = line;
      continue;
    }

    if (current === null) {
      current = startParagraph(line);
      previous = line;
      continue;
    }

    const prior = previous;

    if (prior === null) {
      previous = line;
      continue;
    }

    const block = current;
    const samePage = prior.page === line.page;
    const breaks = samePage
      ? startsNewParagraph(line, prior, bodySize, bodyWidth, leftEdge)
      : prior.width < bodyWidth * 0.62 || endsSentence(prior.text);

    if (breaks) {
      flush();
      current = startParagraph(line);
    } else {
      const joined = joinLine(block.text, line.text);
      const offset = block.text.length + joined.offset;
      const added = (line.marks ?? []).map((mark) => ({
        ...mark,
        start: Math.max(0, mark.start + offset),
        end: Math.max(0, mark.end + offset),
      }));
      const kept =
        joined.offset < 0
          ? block.marks.map((mark) => ({
              ...mark,
              start: Math.min(mark.start, block.text.length - 1),
              end: Math.min(mark.end, block.text.length - 1),
            }))
          : block.marks;

      block.marks = [...kept, ...added];
      block.text = joined.text;
    }

    previous = line;
  }

  flush();

  return blocks;
}
