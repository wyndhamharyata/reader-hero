import { Schema } from "effect";
import type { ImagePlacement } from "@/domain/book";

const MIN_SIDE_PT = 24;
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
  readonly paintFormXObjectBegin: number;
  readonly paintFormXObjectEnd: number;
}

export interface PdfMatrixUtil {
  transform(m1: number[], m2: number[]): number[];
}

export const imagePayloadFields = {
  width: Schema.Number,
  height: Schema.Number,
  data: Schema.optional(Schema.Unknown),
  bitmap: Schema.optional(Schema.Unknown),
};

const InlineImagePayload = Schema.Struct(imagePayloadFields);

type InlineImage = typeof InlineImagePayload.Type;

export interface ImagePaint extends ImagePlacement {
  readonly name?: string;
  readonly inline?: InlineImage;
  readonly imgWidth?: number;
  readonly imgHeight?: number;
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

const numberOr = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

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
  if (width < MIN_SIDE_PT || height < MIN_SIDE_PT) return null;
  return { id, page, x, y, width, height };
};

const objectName = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const inlineImage = (value: unknown): InlineImage | undefined => {
  const decoded = Schema.decodeUnknownOption(InlineImagePayload)(value);
  return decoded._tag === "Some" ? decoded.value : undefined;
};

const pushPaint = (
  paints: ImagePaint[],
  ctm: Matrix,
  page: number,
  index: number,
  source: Pick<ImagePaint, "name" | "inline" | "imgWidth" | "imgHeight">,
): void => {
  if (paints.length >= MAX_IMAGES) return;
  const box = unitSquareBox(ctm, `${page}-${index}`, page);
  if (box === null) return;
  paints.push({ ...box, ...source });
};

export function collectImageBoxes(
  operatorList: ImageOperatorList,
  page: number,
  ops: PdfOps,
  matrixUtil: PdfMatrixUtil,
): ImagePaint[] {
  const paints: ImagePaint[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let paintIndex = 0;

  for (let step = 0; step < operatorList.fnArray.length; step += 1) {
    const operation = operatorList.fnArray[step];
    if (operation === undefined) continue;
    const parameters = operatorList.argsArray[step] ?? [];

    if (operation === ops.save) {
      stack.push(ctm);
      continue;
    }
    if (operation === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (operation === ops.transform) {
      ctm = matrixUtil.transform(ctm, toMatrix(parameters));
      continue;
    }
    // A form draws under its own matrix and gives it back at its end, as pdf.js's canvas does.
    if (operation === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = parameters[0];
      if (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) {
        ctm = matrixUtil.transform(ctm, toMatrix(Array.from(matrix as ArrayLike<unknown>)));
      }
      continue;
    }
    if (operation === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (operation === ops.paintImageXObject) {
      pushPaint(paints, ctm, page, paintIndex, {
        name: objectName(parameters[0]),
        imgWidth: numberOr(parameters[1]),
        imgHeight: numberOr(parameters[2]),
      });
      paintIndex += 1;
      continue;
    }
    if (operation === ops.paintInlineImageXObject) {
      const inline = inlineImage(parameters[0]);
      if (inline !== undefined) {
        pushPaint(paints, ctm, page, paintIndex, {
          inline,
          imgWidth: numberOr(inline.width),
          imgHeight: numberOr(inline.height),
        });
      }
      paintIndex += 1;
    }
  }

  return paints;
}
