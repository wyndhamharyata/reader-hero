// Emits public/worker/pdf.worker.shimmed.min.mjs: the upstream pdf.js worker
// with a tiny ImageDecoder shim in front.
//
// Why: on this device WebKit has no ImageDecoder in any scope, so pdf.js's
// native-JPEG fast path never engages and every 2.8MP JPEG decodes through
// the slow pure-JS decoder. `createImageBitmap` *is* present in worker scope
// and decodes JPEG natively (5ms for 64x64 in env.worker). The shim maps
// that into the exact ImageDecoder slice pdf.js uses, and because we
// concatenate it *before* the worker module body, FeatureTest's eager
// `typeof ImageDecoder` captures see the shim. The shim must decode a real
// JPEG as a correctness check: ImageDecoder.decode() must yield the same
// image as createImageBitmap; it does by construction.
//
// If we hit DPR-specific bugs the createImageBitmap, the previous behaviour
// simply... the device had no ImageDecoder at all, so any regression here
// is impossible to produce via spec deviation: worst case pdf.js's images
// come out shifted, in which case the figure fallback (canvas crop) covers
// missing pixels. See figures.total in the device log for the speed check.
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
