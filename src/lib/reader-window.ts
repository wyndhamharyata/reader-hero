export interface Span {
  readonly start: number;
  readonly end: number;
}

// The chapter holding a block, found by the chapter's first block.
export function chapterAt(spans: ReadonlyArray<Span>, index: number): number {
  let low = 0;
  let high = spans.length - 1;
  let found = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;

    if ((spans[mid]?.start ?? 0) <= index) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

// The blocks the reader mounts: the chapter it shows and one either side, never the whole book.
export function chapterRange(
  spans: ReadonlyArray<Span>,
  center: number,
  blockCount: number,
): { readonly start: number; readonly end: number } {
  const first = Math.max(0, center - 1);
  const last = Math.min(spans.length - 1, center + 1);
  // The chapters start at the first entry, so the book's cover and title pages come before the first of them.
  const start = first === 0 ? 0 : (spans[first]?.start ?? 0);
  const end = spans[last]?.end ?? blockCount;

  return { start: Math.min(start, blockCount), end: Math.min(end, blockCount) };
}
