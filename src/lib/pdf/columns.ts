import type { ImagePlacement } from "@/domain/book";
import type { FlowItem, Positioned, TextLine } from "./types";

const CROSS_MARGIN = 20;
const MIN_COLUMN_LINES = 3;

const byVerticalPosition = (a: Positioned, b: Positioned): number => b.y - a.y || a.x - b.x;

const crossesCenter = (item: Positioned, middle: number): boolean =>
  item.x < middle - CROSS_MARGIN && item.x + item.width > middle + CROSS_MARGIN;

interface ColumnLayout {
  readonly twoColumn: boolean;
  readonly middle: number;
}

function detectColumns(
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

  // A title, an abstract or a footnote may cross the middle; most lines crossing it is one column.
  if (crossing * 4 > left + right || left < MIN_COLUMN_LINES || right < MIN_COLUMN_LINES) {
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

  // Down the page, each line that crosses the middle ends a band: its left column reads, then its right.
  const ordered: typeof entries = [];
  let left: typeof entries = [];
  let right: typeof entries = [];
  const endBand = () => {
    ordered.push(...left, ...right);
    left = [];
    right = [];
  };
  for (const entry of [...entries].sort((a, b) => byVerticalPosition(a.position, b.position))) {
    if (crossesCenter(entry.position, layout.middle)) {
      endBand();
      ordered.push(entry);
      continue;
    }
    const center = entry.position.x + entry.position.width / 2;
    if (center < layout.middle) left.push(entry);
    else right.push(entry);
  }
  endBand();
  return ordered.map((entry) => entry.item);
}
