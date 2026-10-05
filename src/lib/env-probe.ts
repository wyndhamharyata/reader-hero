import { log } from "@/lib/log";

let ran = false;

/**
 * Prints what this device + browser actually exposes, in both the page
 * context and a worker context. Used to decide which pdf.js image-decoder
 * paths can possibly fire here — guessing browser support is unreliable.
 */
export function envProbe(): void {
  if (ran) return;
  ran = true;

  const scope = globalThis as Record<string, unknown>;
  log(
    "env.main",
    [
      `ImageDecoder:${typeof scope.ImageDecoder}`,
      `createImageBitmap:${typeof scope.createImageBitmap}`,
      `OffscreenCanvas:${typeof scope.OffscreenCanvas}`,
      `ImageBitmap:${typeof scope.ImageBitmap}`,
      `secure:${String((globalThis as { isSecureContext?: boolean }).isSecureContext)}`,
    ].join(" "),
  );

  // A small JPEG through canvas so the worker probes decode *real* JPEG data.
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    log("env.probe", "no 2d context on main thread");
    return;
  }
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#2040c0";
  ctx.fillRect(0, 0, 32, 32);
  canvas.toBlob((blob) => {
    if (blob === null) {
      log("env.probe", "toBlob image/jpeg failed");
      return;
    }
    const workerSource = `
      self.onmessage = async (event) => {
        const bytes = new Uint8Array(event.data);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const result = {
          ImageDecoder: typeof ImageDecoder,
          createImageBitmap: typeof createImageBitmap,
          OffscreenCanvas: typeof OffscreenCanvas,
          secure: String(self.isSecureContext),
          decoderMs: null,
          bitmapMs: null,
          decoderError: null,
          bitmapError: null,
          width: 0,
          height: 0,
          typeSupported: null,
        };
        try {
          result.typeSupported = typeof ImageDecoder === "function"
            ? await ImageDecoder.isTypeSupported("image/jpeg")
            : null;
        } catch (error) { result.typeSupportedError = String(error); }
        try {
          const started = performance.now();
          const decoder = new ImageDecoder({ data: bytes, type: "image/jpeg" });
          const frame = await decoder.decode();
          result.decoderMs = performance.now() - started;
          result.width = frame.image.displayWidth || frame.image.width;
          result.height = frame.image.displayHeight || frame.image.height;
          frame.image.close();
        } catch (error) { result.decoderError = String(error); }
        try {
          const started = performance.now();
          const bitmap = await createImageBitmap(blob);
          result.bitmapMs = performance.now() - started;
          result.width = bitmap.width;
          result.height = bitmap.height;
          bitmap.close();
        } catch (error) { result.bitmapError = String(error); }
        self.postMessage(result);
      };
    `;
    const worker = new Worker(
      URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })),
    );
    worker.onmessage = (event) => {
      log("env.worker", JSON.stringify(event.data));
      worker.terminate();
    };
    worker.onerror = (error) => {
      log("env.worker", `error: ${error.message}`);
      worker.terminate();
    };
    blob
      .arrayBuffer()
      .then((buffer) => worker.postMessage(buffer, [buffer]))
      .catch((error) => log("env.worker", `failed to read blob: ${String(error)}`));
  }, "image/jpeg", 0.85);
}
