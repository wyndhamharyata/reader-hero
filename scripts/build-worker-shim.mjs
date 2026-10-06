// iOS WebKit has no ImageDecoder, so pdf.js decodes JPEGs in slow pure JS; this prepends a shim built on createImageBitmap.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const targetDir = join(root, "public", "worker");
const target = join(targetDir, "pdf.worker.shimmed.min.mjs");

const shim = `// Injected at build time by scripts/build-worker-shim.mjs
if (typeof self !== "undefined" && typeof self.ImageDecoder === "undefined") {
  self.ImageDecoder = class ImageDecoder {
    constructor(options) {
      this._options = options ?? {};
    }
    static async isTypeSupported(type) {
      return typeof type === "string" && type.split(";")[0].trim() === "image/jpeg";
    }
    async decode() {
      const options = this._options;
      const bytes = options.data ?? null;
      const blob = new Blob(bytes === null ? [] : [bytes], { type: options.type ?? "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      try {
        bitmap.displayWidth = bitmap.width;
        bitmap.displayHeight = bitmap.height;
      } catch {
        // Non-extensible bitmap: wrap it instead.
        const wrapper = {
          displayWidth: bitmap.width,
          displayHeight: bitmap.height,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
          _bitmap: bitmap,
        };
        return { image: wrapper };
      }
      return { image: bitmap };
    }
    close() {}
  };
}
`;

mkdirSync(targetDir, { recursive: true });
writeFileSync(target, shim + readFileSync(source, "utf8"));
console.log(`patched ${target}`);
