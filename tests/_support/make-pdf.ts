export interface PdfLine {
  readonly text: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
}

export interface PdfImage {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfLink {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly url?: string;
  readonly page?: number;
}

type Part = string | Uint8Array;

const escapeText = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// The page box is [0 0 612 792] unless one is given, as a cropped or offset page has.
export function makePdf(
  lines: ReadonlyArray<PdfLine>,
  image?: PdfImage,
  mediaBox: readonly [number, number, number, number] = [0, 0, 612, 792],
  links: ReadonlyArray<PdfLink> = [],
): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;

  const pushText = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };

  const contentLines = lines.map(
    (line) => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${escapeText(line.text)}) Tj ET`,
  );
  if (image !== undefined) {
    contentLines.push(`q ${image.width} 0 0 ${image.height} ${image.x} ${image.y} cm /Im0 Do Q`);
  }
  const content = contentLines.join("\n");
  const imageBytes = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const firstLink = 6 + (image === undefined ? 0 : 1);
  const annots =
    links.length === 0
      ? ""
      : ` /Annots [${links.map((_, index) => `${firstLink + index} 0 R`).join(" ")}]`;

  const objects: Part[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}] /Resources << /Font << /F1 5 0 R >>${
        image === undefined ? "" : " /XObject << /Im0 6 0 R >>"
      } >> /Contents 4 0 R${annots} >>`,
    ],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ];
  if (image !== undefined) {
    objects.push([
      `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n`,
      imageBytes,
      "\nendstream",
    ]);
  }
  for (const link of links) {
    const action =
      link.url === undefined
        ? `/Dest [3 0 R /XYZ null null null]`
        : `/A << /S /URI /URI (${escapeText(link.url)}) >>`;

    objects.push([
      `<< /Type /Annot /Subtype /Link /Rect [${link.x} ${link.y} ${link.x + link.width} ${link.y + link.height}] /Border [0 0 0] ${action} >>`,
    ]);
  }

  pushText("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((parts, index) => {
    offsets.push(length);
    pushText(`${index + 1} 0 obj\n`);
    for (const part of parts) {
      if (typeof part === "string") pushText(part);
      else pushBytes(part);
    }
    pushText("\nendobj\n");
  });

  const xref = length;
  pushText(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((offset) => pushText(`${String(offset).padStart(10, "0")} 00000 n \n`));
  pushText(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}
