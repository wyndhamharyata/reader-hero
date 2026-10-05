import type { PageText, RawTextItem } from "@/domain/book";
import type { TextLine } from "./types";

const LINE_TOLERANCE = 0.45;
const SPACE_FACTOR = 0.22;

function makeLine(page: number, items: ReadonlyArray<RawTextItem>): TextLine {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let previousEnd: number | null = null;
  let maxSize = 0;
  let fontFamily = "";
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const item of sorted) {
    if (previousEnd !== null) {
      const gap = item.x - previousEnd;
      if (gap > item.fontSize * SPACE_FACTOR && !text.endsWith(" ")) text += " ";
    }
    text += item.str;
    previousEnd = item.x + item.width;
    maxSize = Math.max(maxSize, item.fontSize);
    if (fontFamily === "" && item.fontFamily !== "") fontFamily = item.fontFamily;
    minX = Math.min(minX, item.x);
    maxX = Math.max(maxX, item.x + item.width);
  }

  return {
    page,
    text: text.replace(/\s+/g, " ").trim(),
    x: minX,
    y: sorted[0]?.y ?? 0,
    width: maxX - minX,
    fontSize: maxSize,
    fontFamily,
  };
}

export function buildLines(page: PageText): ReadonlyArray<TextLine> {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  let bucket: RawTextItem[] = [];
  let bucketY = Number.NaN;

  const flush = () => {
    if (bucket.length === 0) return;
    const line = makeLine(page.page, bucket);
    if (line.text.length > 0) lines.push(line);
    bucket = [];
  };

  for (const item of items) {
    const tolerance = Math.max(2, item.fontSize * LINE_TOLERANCE);
    if (bucket.length > 0 && Math.abs(item.y - bucketY) > tolerance) flush();
    if (bucket.length === 0) bucketY = item.y;
    bucket.push(item);
  }
  flush();

  return lines;
}
