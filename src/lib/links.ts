const BLOCK_LINK_PREFIX = "#block-";
const PAGE_LINK_PREFIX = "page:";

export const blockLink = (index: number): string => `${BLOCK_LINK_PREFIX}${index}`;

export function blockIndexOf(href: string): number | null {
  if (!href.startsWith(BLOCK_LINK_PREFIX)) return null;

  const index = Number(href.slice(BLOCK_LINK_PREFIX.length));

  return Number.isInteger(index) ? index : null;
}

export const pageLink = (page: number): string => `${PAGE_LINK_PREFIX}${page}`;

export function pageOfLink(href: string): number | null {
  if (!href.startsWith(PAGE_LINK_PREFIX)) return null;

  const page = Number(href.slice(PAGE_LINK_PREFIX.length));

  return Number.isInteger(page) && page > 0 ? page : null;
}
