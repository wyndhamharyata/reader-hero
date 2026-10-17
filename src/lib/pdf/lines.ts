import type { PageText, RawTextItem } from "@/domain/book";
import type { TextLine } from "./types";

const LINE_TOLERANCE = 0.45;
const SPACE_FACTOR = 0.22;
// A space this many ems wide over the page's middle is a column gutter, wider than any word space.
const GUTTER_FACTOR = 1;
const GUTTER_MARGIN_PT = 20;
// At least 3 rows with a gutter, and a third of all rows, make a page two columns.
const MIN_GUTTER_ROWS = 3;

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
    // A space item can run to the next column. The line ends where its text does.
    if (item.str.trim() === "") continue;
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

function gutterAt(row: ReadonlyArray<RawTextItem>, middle: number): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const [index, item] of row.entries()) {
    // pdf.js inserts a space item across a wide space, which would hide the gutter.
    if (item.str.trim() === "") continue;
    const gap = item.x - end;
    if (index > 0 && gap >= item.fontSize * GUTTER_FACTOR) {
      if (end <= middle + GUTTER_MARGIN_PT && item.x >= middle - GUTTER_MARGIN_PT) return index;
    }
    end = Math.max(end, item.x + item.width);
  }
  return -1;
}

export function buildLines(page: PageText): ReadonlyArray<TextLine> {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: RawTextItem[][] = [];
  let bucketY = Number.NaN;
  for (const item of items) {
    const tolerance = Math.max(2, item.fontSize * LINE_TOLERANCE);
    const row = rows.at(-1);
    if (row !== undefined && Math.abs(item.y - bucketY) <= tolerance) {
      row.push(item);
      continue;
    }
    rows.push([item]);
    bucketY = item.y;
  }

  // Two columns share baselines, so their rows split at the gutter. One wide space on one line splits nothing.
  const middle = page.width / 2;
  const sorted = rows.map((row) => [...row].sort((a, b) => a.x - b.x));
  const splits = sorted.map((row) => gutterAt(row, middle));
  const gutters = splits.filter((at) => at !== -1).length;
  const twoColumn = gutters >= MIN_GUTTER_ROWS && gutters * 3 >= rows.length;

  const lines: TextLine[] = [];
  const push = (row: ReadonlyArray<RawTextItem>) => {
    const line = makeLine(page.page, row);
    if (line.text.length > 0) lines.push(line);
  };
  sorted.forEach((row, index) => {
    const at = splits[index] ?? -1;
    if (!twoColumn || at === -1) {
      push(row);
      return;
    }
    push(row.slice(0, at));
    push(row.slice(at));
  });
  return lines;
}
