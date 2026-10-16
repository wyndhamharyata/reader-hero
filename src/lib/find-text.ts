// Case and runs of whitespace never decide a match, so a line break in the PDF reads as a space.
export function searchForm(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ");
}

// Each page with a match, once, in page order; the parsed text covers every page that has text.
export function findPages(
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }>,
  query: string,
): number[] {
  const wanted = searchForm(query).trim();
  if (wanted === "") return [];
  const pages = new Set<number>();
  for (const block of blocks) {
    if (!pages.has(block.page) && searchForm(block.text).includes(wanted)) pages.add(block.page);
  }
  return [...pages].sort((a, b) => a - b);
}
