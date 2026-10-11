import { Effect } from "effect";

// A JPEG 400 px wide, like a rendered cover, so a large photo does not fill the store; null when it does not decode.
export function shrinkPicture(
  picture: Blob,
): Effect.Effect<{ readonly blob: Blob; readonly width: number; readonly height: number } | null> {
  return Effect.gen(function* () {
    const bitmap = yield* Effect.option(Effect.tryPromise(() => createImageBitmap(picture)));
    if (bitmap._tag === "None") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = Math.round((400 * bitmap.value.height) / bitmap.value.width);
    canvas.getContext("2d")?.drawImage(bitmap.value, 0, 0, canvas.width, canvas.height);
    bitmap.value.close();
    const blob = yield* Effect.callback<Blob | null>((resume) =>
      canvas.toBlob((value) => resume(Effect.succeed(value)), "image/jpeg", 0.85),
    );
    return blob === null ? null : { blob, width: canvas.width, height: canvas.height };
  });
}
