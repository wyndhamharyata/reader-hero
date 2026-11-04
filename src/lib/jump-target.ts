// A library sheet opens a book at a highlight, so the reader takes the place once and forgets it.
let target: { readonly bookId: string; readonly block: number } | null = null;

export function setJumpTarget(bookId: string, block: number): void {
  target = { bookId, block };
}

export function takeJumpTarget(bookId: string): number | null {
  if (target?.bookId !== bookId) return null;

  const block = target.block;

  target = null;

  return block;
}
