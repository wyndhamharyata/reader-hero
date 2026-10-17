import type { ImagePlacement } from "@/domain/book";
import type { FlowItem, Positioned, TextLine } from "./types";

const CROSS_MARGIN_PT = 20;
const MIN_COLUMN_LINES = 3;

const byVerticalPosition = (a: Positioned, b: Positioned): number => b.y - a.y || a.x - b.x;

const crossesCenter = (item: Positioned, middle: number): boolean =>
  item.x < middle - CROSS_MARGIN_PT && item.x + item.width > middle + CROSS_MARGIN_PT;

interface ColumnLayout {
  readonly hasTwoColumns: boolean;
  readonly middle: number;
}

function detectColumns(lines: ReadonlyArray<Positioned>, pageWidth: number): ColumnLayout {
  const middle = pageWidth / 2;

  if (lines.length < MIN_COLUMN_LINES * 2 || pageWidth <= 0) {
    return { hasTwoColumns: false, middle };
  }

  let crossing = 0;
  let left = 0;
  let right = 0;

  for (const line of lines) {
    if (crossesCenter(line, middle)) crossing += 1;
    else if (line.x + line.width <= middle + CROSS_MARGIN_PT) left += 1;
    else if (line.x >= middle - CROSS_MARGIN_PT) right += 1;
  }

  // A title, an abstract or a footnote may cross the middle. A fifth of the side lines crossing it means one column.
  if (crossing * 4 > left + right || left < MIN_COLUMN_LINES || right < MIN_COLUMN_LINES) {
    return { hasTwoColumns: false, middle };
  }

  return { hasTwoColumns: true, middle };
}

export function orderFlow(
  textLines: ReadonlyArray<TextLine>,
  images: ReadonlyArray<ImagePlacement>,
  pageWidth: number,
): FlowItem[] {
  const layout = detectColumns(textLines, pageWidth);

  const entries = [
    ...textLines.map((line) => ({
      position: line as Positioned,
      item: { type: "text" as const, line },
    })),
    ...images.map((image) => ({
      position: image as Positioned,
      item: { type: "image" as const, image },
    })),
  ];

  if (!layout.hasTwoColumns) {
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
