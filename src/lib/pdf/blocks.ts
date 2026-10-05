import { median, type FlowItem, type RawBlock, type TextLine } from "./types";

const HEADING_LEVELS: ReadonlyArray<{ readonly ratio: number; readonly level: number }> = [
  { ratio: 1.8, level: 1 },
  { ratio: 1.35, level: 2 },
  { ratio: 1.15, level: 3 },
];

const endsSentence = (text: string): boolean => /[.!?:;]["')\]]?$/.test(text);
const endsHyphen = (text: string): boolean => /[a-z]-$/.test(text);

function headingLevel(line: TextLine, bodySize: number): number {
  if (bodySize <= 0) return 0;
  const ratio = line.fontSize / bodySize;
  for (const entry of HEADING_LEVELS) {
    if (ratio >= entry.ratio) return entry.level;
  }
  return 0;
}

function joinText(text: string, next: string): string {
  if (endsHyphen(text) && /^[a-z]/.test(next)) return `${text.slice(0, -1)}${next}`;
  return `${text} ${next}`;
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

function breaksAtPage(line: TextLine, previous: TextLine, bodyWidth: number): boolean {
  if (previous.width < bodyWidth * 0.62) return true;
  return endsSentence(previous.text);
}

export function buildBlocks(items: ReadonlyArray<FlowItem>): ReadonlyArray<RawBlock> {
  if (items.length === 0) return [];

  const textLines = items.flatMap((item) => (item.type === "text" ? [item.line] : []));
  const bodySize = median(textLines.map((line) => line.fontSize));
  const bodyWidth = median(textLines.map((line) => line.width));
  const leftEdge = textLines.length > 0 ? Math.min(...textLines.map((line) => line.x)) : 0;

  const blocks: RawBlock[] = [];
  let current: { kind: "paragraph"; level: number; text: string; page: number } | null = null;
  let previous: TextLine | null = null;

  const flush = () => {
    if (current !== null) blocks.push(current);
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
      });
      previous = null;
      continue;
    }

    const line = item.line;
    const level = headingLevel(line, bodySize);
    if (level > 0) {
      flush();
      blocks.push({ kind: "heading", level, text: line.text, page: line.page });
      previous = line;
      continue;
    }

    if (current === null) {
      current = { kind: "paragraph", level: 0, text: line.text, page: line.page };
      previous = line;
      continue;
    }

    const prior = previous;
    if (prior === null) {
      previous = line;
      continue;
    }

    const samePage = prior.page === line.page;
    const breaks = samePage
      ? startsNewParagraph(line, prior, bodySize, bodyWidth, leftEdge)
      : breaksAtPage(line, prior, bodyWidth);

    if (breaks) {
      flush();
      current = { kind: "paragraph", level: 0, text: line.text, page: line.page };
    } else {
      current.text = joinText(current.text, line.text);
    }
    previous = line;
  }

  flush();
  return blocks;
}
