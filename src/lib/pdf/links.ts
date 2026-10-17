import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageLinkBox } from "@/domain/book";

// pdf.js AnnotationType.LINK.
const LINK_ANNOTATION = 2;
// Only schemes a reader expects a tap to open. pdf.js has already checked the URL is absolute.
const OPENABLE = /^(https?|mailto|tel):/i;

const isOpenableUrl = (url: string): boolean => OPENABLE.test(url);

async function destinationPage(document: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  const resolved = typeof dest === "string" ? await document.getDestination(dest) : dest;

  if (!Array.isArray(resolved) || resolved.length === 0) return null;

  const [ref] = resolved as unknown[];

  if (typeof ref === "number" && Number.isInteger(ref)) return ref + 1;
  if (typeof ref !== "object" || ref === null) return null;

  return (await document.getPageIndex(ref as never)) + 1;
}

export async function readLinkBoxes(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
): Promise<PageLinkBox[]> {
  const viewport = page.getViewport({ scale: 1 });
  const links: PageLinkBox[] = [];

  for (const annotation of await page.getAnnotations({ intent: "display" })) {
    if (annotation.annotationType !== LINK_ANNOTATION) continue;

    const rect = annotation.rect;
    const url = annotation.url;

    if (!Array.isArray(rect) || rect.length < 4) continue;

    let target: PageLinkBox["target"] | null = null;

    if (typeof url === "string" && isOpenableUrl(url)) target = { url };
    else if (annotation.dest !== undefined) {
      const linked = await destinationPage(document, annotation.dest).catch(() => null);

      if (linked !== null) target = { page: linked };
    }

    if (target === null) continue;

    const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(
      rect[0] ?? 0,
      rect[1] ?? 0,
    ) as number[];
    const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(
      rect[2] ?? 0,
      rect[3] ?? 0,
    ) as number[];

    links.push({
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
      bottom: viewport.height - Math.max(y1, y2),
      top: viewport.height - Math.min(y1, y2),
      target,
    });
  }

  return links;
}
