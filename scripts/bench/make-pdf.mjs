// Writes the benchmark PDF: 600 text pages, a heading every 10 pages, a 640x480 RGB image on every 20th page.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchDir } from "./paths.mjs";

const PAGES = 600;
const LINES = 38;
const IMAGE_W = 640;
const IMAGE_H = 480;
const words =
  "the quick brown fox jumps over the lazy dog while the river runs past the old mill and the wind carries dust across the valley road toward the distant hills where nobody waits".split(
    " ",
  );

const escape = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// A short line every fourth line, so the reflow sees a paragraph break there.
const lineText = (page, line) => {
  const start = (page * 7 + line * 3) % words.length;
  const count = line % 4 === 3 ? 5 : 14;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(words[(start + i) % words.length]);
  return out.join(" ");
};

export function makeBenchPdf(path) {
  const encoder = new TextEncoder();
  const chunks = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };

  const objects = [];
  const add = (parts) => {
    objects.push(parts);
    return objects.length;
  };

  const catalog = add(["<< /Type /Catalog /Pages 2 0 R >>"]);
  const pagesIndex = add([]);
  const font = add(["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
  const kids = [];

  for (let p = 1; p <= PAGES; p += 1) {
    const hasImage = p % 20 === 0;
    const content = [];
    let y = 720;
    for (let l = 0; l < LINES; l += 1) {
      if (l === 0 && p % 10 === 1) {
        content.push(`BT /F1 20 Tf 72 ${y} Td (Chapter ${Math.ceil(p / 10)}) Tj ET`);
        y -= 28;
        continue;
      }
      if (hasImage && l === 18) {
        content.push(`q 300 0 0 200 156 ${y - 200} cm /Im0 Do Q`);
        y -= 216;
        continue;
      }
      content.push(`BT /F1 11 Tf 72 ${y} Td (${escape(lineText(p, l))}) Tj ET`);
      y -= 16;
    }
    content.push(`BT /F1 9 Tf 300 40 Td (${p}) Tj ET`);
    const stream = content.join("\n");
    const contentObj = add([
      `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    ]);
    let imageObj = null;
    if (hasImage) {
      const bytes = new Uint8Array(IMAGE_W * IMAGE_H * 3);
      for (let i = 0; i < IMAGE_W * IMAGE_H; i += 1) {
        const x = i % IMAGE_W;
        const yy = Math.floor(i / IMAGE_W);
        bytes[i * 3] = (x * 2 + p) & 255;
        bytes[i * 3 + 1] = (yy * 2 + p * 3) & 255;
        bytes[i * 3 + 2] = ((x ^ yy) * 4) & 255;
      }
      imageObj = add([
        `<< /Type /XObject /Subtype /Image /Width ${IMAGE_W} /Height ${IMAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${bytes.length} >>\nstream\n`,
        bytes,
        "\nendstream",
      ]);
    }
    const pageObj = add([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >>${
        imageObj === null ? "" : ` /XObject << /Im0 ${imageObj} 0 R >>`
      } >> /Contents ${contentObj} 0 R >>`,
    ]);
    kids.push(`${pageObj} 0 R`);
  }
  objects[pagesIndex - 1] = [`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${PAGES} >>`];

  push("%PDF-1.4\n");
  const offsets = [];
  objects.forEach((parts, index) => {
    offsets.push(length);
    push(`${index + 1} 0 obj\n`);
    for (const part of parts) push(part);
    push("\nendobj\n");
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((offset) => push(`${String(offset).padStart(10, "0")} 00000 n \n`));
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  mkdirSync(benchDir, { recursive: true });
  writeFileSync(path, out);
  return { pages: PAGES, bytes: length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const made = makeBenchPdf(join(benchDir, "bench.pdf"));
  console.log(`bench.pdf: ${made.pages} pages, ${Math.round(made.bytes / 1024)} KB`);
}
