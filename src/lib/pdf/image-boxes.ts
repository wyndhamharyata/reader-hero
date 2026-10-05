import type { ImagePlacement } from "@/domain/book";

const MIN_SIDE = 24;
const MAX_IMAGES = 24;

export interface ImageOperatorList {
  readonly fnArray: ReadonlyArray<number>;
  readonly argsArray: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface PdfOps {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly paintImageXObject: number;
  readonly paintInlineImageXObject: number;
}

export interface PdfMatrixUtil {
  transform(m1: number[], m2: number[]): number[];
}

type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const toMatrix = (value: ReadonlyArray<unknown>): Matrix => [
  Number(value[0] ?? 0),
  Number(value[1] ?? 0),
  Number(value[2] ?? 0),
  Number(value[3] ?? 0),
  Number(value[4] ?? 0),
  Number(value[5] ?? 0),
];

const applyPoint = (matrix: Matrix, x: number, y: number): readonly [number, number] => [
  (matrix[0] ?? 0) * x + (matrix[2] ?? 0) * y + (matrix[4] ?? 0),
  (matrix[1] ?? 0) * x + (matrix[3] ?? 0) * y + (matrix[5] ?? 0),
];

const unitSquareBox = (matrix: Matrix, id: string, page: number): ImagePlacement | null => {
  const corners = [
    applyPoint(matrix, 0, 0),
    applyPoint(matrix, 1, 0),
    applyPoint(matrix, 0, 1),
    applyPoint(matrix, 1, 1),
  ];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < MIN_SIDE || height < MIN_SIDE) return null;
  return { id, page, x, y, width, height };
};

export function collectImageBoxes(
  opList: ImageOperatorList,
  page: number,
  ops: PdfOps,
  util: PdfMatrixUtil,
): ImagePlacement[] {
  const boxes: ImagePlacement[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let index = 0;

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    if (fn === undefined) continue;
    const args = opList.argsArray[i] ?? [];

    if (fn === ops.save) {
      stack.push(ctm);
      continue;
    }
    if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn === ops.transform) {
      ctm = util.transform(ctm, toMatrix(args));
      continue;
    }
    if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      if (boxes.length >= MAX_IMAGES) break;
      const box = unitSquareBox(ctm, `${page}-${index}`, page);
      if (box !== null) boxes.push(box);
      index += 1;
    }
  }

  return boxes;
}
