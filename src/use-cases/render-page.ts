import { Effect } from "effect";
import type { PdfFailure } from "@/domain/errors";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

export function renderPdfPage(
  handle: PdfHandle,
  page: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Effect.Effect<void, PdfFailure, PdfClient> {
  return Effect.flatMap(PdfClient, (pdf) => pdf.render(handle, page, canvas, scale));
}
