import type { TextLine } from "./types";

const CROSS_MARGIN = 20;
const MIN_COLUMN_LINES = 3;

const byVerticalPosition = (a: TextLine, b: TextLine): number => b.y - a.y || a.x - b.x;

function crossesCenter(line: TextLine, middle: number): boolean {
  return line.x < middle - CROSS_MARGIN && line.x + line.width > middle + CROSS_MARGIN;
}

export function orderPageLines(
  lines: ReadonlyArray<TextLine>,
  pageWidth: number,
): ReadonlyArray<TextLine> {
  const ordered = [...lines].sort(byVerticalPosition);
  if (ordered.length < MIN_COLUMN_LINES * 2 || pageWidth <= 0) return ordered;

  const middle = pageWidth / 2;
  const left: TextLine[] = [];
  const right: TextLine[] = [];
  let crossing = 0;

  for (const line of ordered) {
    if (crossesCenter(line, middle)) {
      crossing += 1;
    } else if (line.x + line.width <= middle + CROSS_MARGIN) {
      left.push(line);
    } else if (line.x >= middle - CROSS_MARGIN) {
      right.push(line);
    }
  }

  if (crossing > 0) return ordered;
  if (left.length < MIN_COLUMN_LINES || right.length < MIN_COLUMN_LINES) return ordered;

  return [...left.sort(byVerticalPosition), ...right.sort(byVerticalPosition)];
}
