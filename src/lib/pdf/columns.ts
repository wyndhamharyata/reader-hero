import type { ImagePlacement } from "@/domain/book";
import type { FlowItem, Positioned, TextLine } from "./types";

const CROSS_MARGIN = 20;
const MIN_COLUMN_LINES = 3;

const byVerticalPosition = (a: Positioned, b: Positioned): number => b.y - a.y || a.x - b.x;

const crossesCenter = (item: Positioned, middle: number): boolean =>
  item.x < middle - CROSS_MARGIN && item.x + item.width > middle + CROSS_MARGIN;

export interface ColumnLayout {
  readonly twoColumn: boolean;
  readonly middle: number;
}

export function detectColumns(
  lines: ReadonlyArray<Positioned>,
  pageWidth: number,
): ColumnLayout {
  const middle = pageWidth / 2;
  if (lines.length < MIN_COLUMN_LINES * 2 || pageWidth <= 0) {
    return { twoColumn: false, middle };
  }

  let crossing = 0;
  let left = 0;
  let right = 0;

  for (const line of lines) {
    if (crossesCenter(line, middle)) crossing += 1;
    else if (line.x + line.width <= middle + CROSS_MARGIN) left += 1;
    else if (line.x >= middle - CROSS_MARGIN) right += 1;
  }

  if (crossing > 0 || left < MIN_COLUMN_LINES || right < MIN_COLUMN_LINES) {
    return { twoColumn: false, middle };
  }
  return { twoColumn: true, middle };
}

export function orderFlow(
  textLines: ReadonlyArray<TextLine>,
  images: ReadonlyArray<ImagePlacement>,
  pageWidth: number,
): FlowItem[] {
  const layout = detectColumns(textLines, pageWidth);

  const entries = [
    ...textLines.map((line) => ({ position: line as Positioned, item: { type: "text" as const, line } })),
    ...images.map((image) => ({ position: image as Positioned, item: { type: "image" as const, image } })),
  ];

  if (!layout.twoColumn) {
    return [...entries]
      .sort((a, b) => byVerticalPosition(a.position, b.position))
      .map((entry) => entry.item);
  }

  const left: typeof entries = [];
  const right: typeof entries = [];
  for (const entry of entries) {
    const center = entry.position.x + entry.position.width / 2;
    if (center < layout.middle) left.push(entry);
    else right.push(entry);
  }

  return [
    ...left.sort((a, b) => byVerticalPosition(a.position, b.position)),
    ...right.sort((a, b) => byVerticalPosition(a.position, b.position)),
  ].map((entry) => entry.item);
}
