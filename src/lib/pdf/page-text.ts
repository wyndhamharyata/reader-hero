import type { PageViewport, PDFPageProxy } from "pdfjs-dist";
import type { PageText, RawTextItem } from "@/domain/book";

// A text item's transform holds its position (e, f) and scale (c, d); the scale is the font size.
export function toPageText(
  page: number,
  content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>,
  viewport: PageViewport,
): PageText {
  const items: RawTextItem[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const [, , c = 0, d = 0, e = 0, f = 0] = (item.transform as ReadonlyArray<unknown>).map(
      (value) => (typeof value === "number" ? value : 0),
    );
    // Through the page's own box, so a rotated page or one whose box does not start at 0,0 reads like any other;
    // y counts up from the bottom again, as the rest of the pipeline expects.
    const [x = e, down = viewport.height - f] = viewport.convertToViewportPoint(e, f) as number[];
    items.push({
      str: item.str,
      x,
      y: viewport.height - down,
      width: item.width,
      height: item.height,
      fontSize: Math.hypot(c, d) || item.height,
      fontFamily: content.styles[item.fontName]?.fontFamily ?? "",
      hasEOL: item.hasEOL,
    });
  }
  return { page, width: viewport.width, height: viewport.height, items };
}
