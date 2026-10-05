import type { BlockKind } from "@/domain/book";

export interface TextLine {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fontSize: number;
  readonly fontFamily: string;
}

export interface RawBlock {
  readonly kind: BlockKind;
  readonly level: number;
  readonly text: string;
  readonly page: number;
}

export interface PageLines {
  readonly page: number;
  readonly height: number;
  readonly lines: ReadonlyArray<TextLine>;
}

export function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
