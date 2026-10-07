// Draws a decoded PDF image at the reader's size and encodes it as JPEG, off the main thread.
onmessage = async (event: MessageEvent) => {
  const request = event.data as {
    id: number;
    width: number;
    height: number;
    maxDim: number;
    source: ImageBitmap | { bytes: Uint8ClampedArray<ArrayBuffer>; alpha: boolean };
  };
  let blob: Blob | null = null;
  try {
    const scale = Math.min(1, request.maxDim / Math.max(request.width, request.height));
    const out = new OffscreenCanvas(
      Math.max(1, Math.round(request.width * scale)),
      Math.max(1, Math.round(request.height * scale)),
    );
    const context = out.getContext("2d");
    if (context !== null) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, out.width, out.height);
      const source = request.source;
      if (source instanceof ImageBitmap) {
        context.drawImage(source, 0, 0, out.width, out.height);
        source.close();
      } else {
        const expected = request.width * request.height * 4;
        let rgba = source.bytes;
        if (!source.alpha || rgba.length !== expected) {
          rgba = new Uint8ClampedArray(expected);
          let at = 0;
          for (let dest = 0; dest < expected; dest += 4) {
            rgba[dest] = source.bytes[at] ?? 0;
            rgba[dest + 1] = source.bytes[at + 1] ?? 0;
            rgba[dest + 2] = source.bytes[at + 2] ?? 0;
            rgba[dest + 3] = 255;
            at += 3;
          }
        }
        const full = new OffscreenCanvas(request.width, request.height);
        const fullContext = full.getContext("2d");
        if (fullContext !== null) {
          fullContext.putImageData(new ImageData(rgba, request.width, request.height), 0, 0);
          context.drawImage(full, 0, 0, out.width, out.height);
        }
      }
      blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    }
  } catch {
    blob = null;
  }
  postMessage({ id: request.id, blob });
};
