// Enough for about 6 pages in the list on a phone, and a foldout stays under WebKit's canvas limit.
const PAGE_PIXELS = 4_194_304;

// Device pixels per PDF point for a page shown `width` CSS pixels wide, never softer than the old fixed 1.5.
export function pageRenderScale(
  size: { readonly width: number; readonly height: number },
  width: number,
  ratio: number,
): number {
  const wanted = Math.max(Math.min(1.5, ratio), (width / size.width) * ratio);
  const cap = Math.sqrt(PAGE_PIXELS / (size.width * size.height));
  // Steps of 0.05, so a resize of a few pixels draws no page again.
  return Math.floor(Math.min(wanted, cap) * 20) / 20;
}
