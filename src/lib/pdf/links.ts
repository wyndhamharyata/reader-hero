import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { PageLinkBox } from "@/domain/book";
import { isOpenableUrl } from "@/lib/links";

// pdf.js AnnotationType.LINK.
const LINK_ANNOTATION = 2;

async function destinationPage(document: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  const resolved = typeof dest === "string" ? await document.getDestination(dest) : dest;

  if (!Array.isArray(resolved) || resolved.length === 0) return null;

  const [ref] = resolved as unknown[];

  if (typeof ref === "number" && Number.isInteger(ref)) return ref + 1;
  if (typeof ref !== "object" || ref === null) return null;

  return (await document.getPageIndex(ref as never)) + 1;
}

async function readTarget(
  document: PDFDocumentProxy,
  url: unknown,
  dest: unknown,
): Promise<PageLinkBox["target"] | null> {
  if (typeof url === "string" && isOpenableUrl(url)) return { url };

  if (dest === undefined) return null;

  const page = await destinationPage(document, dest).catch(() => null);

  return page === null ? null : { page };
}

async function readBox(
  document: PDFDocumentProxy,
  viewport: PageViewport,
  annotation: { annotationType: number; rect?: unknown; url?: unknown; dest?: unknown },
): Promise<PageLinkBox | null> {
  if (annotation.annotationType !== LINK_ANNOTATION) return null;

  const rect = annotation.rect;

  if (!Array.isArray(rect) || rect.length < 4) return null;

  const target = await readTarget(document, annotation.url, annotation.dest);

  if (target === null) return null;

  const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(rect[0] ?? 0, rect[1] ?? 0) as number[];
  const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(rect[2] ?? 0, rect[3] ?? 0) as number[];

  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    bottom: viewport.height - Math.max(y1, y2),
    top: viewport.height - Math.min(y1, y2),
    target,
  };
}

export async function readLinkBoxes(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
): Promise<PageLinkBox[]> {
  const viewport = page.getViewport({ scale: 1 });
  const annotations = await page.getAnnotations({ intent: "display" });
  const boxes = await Promise.all(
    annotations.map((annotation) => readBox(document, viewport, annotation)),
  );

  return boxes.filter((box): box is PageLinkBox => box !== null);
}
