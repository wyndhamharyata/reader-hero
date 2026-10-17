// Copies the pdf.js WASM decoders and ICC profile into public/, where the dev server and the app serve them at stable URLs.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "node_modules", "pdfjs-dist");
const to = join(root, "public");

// [source under node_modules/pdfjs-dist, destination under public/]
const files = [
  ["wasm/openjpeg.wasm", "wasm/openjpeg.wasm"],
  ["wasm/jbig2.wasm", "wasm/jbig2.wasm"],
  ["wasm/qcms_bg.wasm", "wasm/qcms_bg.wasm"],
  ["iccs/CGATS001Compat-v2-micro.icc", "icc/CGATS001Compat-v2-micro.icc"],
];

for (const [source, target] of files) {
  const targetPath = join(to, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(join(from, source), targetPath);
}
console.log(`copied ${files.length} pdf.js wasm/icc files into public/`);
