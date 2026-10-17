export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export function trimTextRanges<T extends TextRange>(
  text: string,
  ranges: ReadonlyArray<T>,
): Array<T> {
  const lead = text.length - text.trimStart().length;
  const body = text.trim();

  return ranges
    .map((range) => ({
      ...range,
      start: Math.max(0, range.start - lead),
      end: Math.min(body.length, range.end - lead),
    }))
    .filter((range) => range.end > range.start);
}
