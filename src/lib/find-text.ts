// Case and runs of whitespace never decide a match, so a line break in the PDF reads as a space.
export function searchForm(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ");
}

// Each page that may hold a match, once, in page order; the render worker then checks each against its own text.
// The page's text as the text layer joins it: runs end to end, a line end as a space.
export function pageSearchText(
  items: ReadonlyArray<{ readonly str?: string; readonly hasEOL?: boolean }>,
): string {
  return searchForm(
    items.map((item) => `${item.str ?? ""}${item.hasEOL === true ? " " : ""}`).join(""),
  );
}

export function findPages(
  blocks: ReadonlyArray<{ readonly text: string; readonly page: number }>,
  query: string,
): number[] {
  const wanted = searchForm(query).trim();
  if (wanted === "") return [];
  const pages = new Set<number>();
  for (const [index, block] of blocks.entries()) {
    if (!searchForm(block.text).includes(wanted)) continue;
    pages.add(block.page);
    // A block holds only the page it starts on; one that runs on to the next page may match there.
    const next = blocks[index + 1]?.page ?? block.page;
    if (next > block.page) pages.add(block.page + 1);
  }
  return [...pages].sort((a, b) => a - b);
}
