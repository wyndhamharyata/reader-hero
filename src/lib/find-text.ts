// Case and runs of whitespace never decide a match, so a line break in the PDF reads as a space.
export function searchForm(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ");
}

// Joined as the text layer joins it, so a confirmed page always has marks.
export function pageSearchText(
  items: ReadonlyArray<{ readonly str?: string; readonly hasEOL?: boolean }>,
): string {
  return searchForm(
    items.map((item) => `${item.str ?? ""}${item.hasEOL === true ? " " : ""}`).join(""),
  );
}

// Pages that may hold a match, in order. The render worker confirms each against its own text.
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

    // A block holds only the page it starts on. One that runs on to the next page may match there.
    const next = blocks[index + 1]?.page ?? block.page;

    if (next > block.page) pages.add(block.page + 1);
  }

  return [...pages].sort((a, b) => a - b);
}

export interface BlockMatch {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

// A common word in a long book has thousands of matches, so a search stops here.
export const maxMatches = 500;

// Every match in the book's text, in order, up to `max`.
export function findInBlocks(
  blocks: ReadonlyArray<{ readonly kind: string; readonly text: string }>,
  query: string,
  max = maxMatches,
): ReadonlyArray<BlockMatch> {
  const wanted = query.trim().toLocaleLowerCase();
  const found: Array<BlockMatch> = [];

  if (wanted === "") return found;

  for (const [index, block] of blocks.entries()) {
    if (block.kind === "image") continue;

    const text = block.text.toLocaleLowerCase();

    for (let at = text.indexOf(wanted); at !== -1; at = text.indexOf(wanted, at + wanted.length)) {
      if (found.length === max) return found;

      found.push({ index, start: at, end: at + wanted.length });
    }
  }

  return found;
}

// The words around a match, cut at word ends, so a result reads as a phrase.
export function snippetOf(
  text: string,
  match: { readonly start: number; readonly end: number },
  radius = 48,
): { readonly before: string; readonly match: string; readonly after: string } {
  const from = Math.max(0, text.lastIndexOf(" ", Math.max(0, match.start - radius)) + 1);
  const cut = text.indexOf(" ", Math.min(text.length, match.end + radius));
  const to = cut === -1 ? text.length : cut;

  return {
    before: `${from > 0 ? "…" : ""}${text.slice(from, match.start)}`,
    match: text.slice(match.start, match.end),
    after: `${text.slice(match.end, to)}${to < text.length ? "…" : ""}`,
  };
}
