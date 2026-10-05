import { OPS, Util } from "pdfjs-dist";
import { describe, expect, it } from "vitest";
import { collectImageBoxes, type ImageOperatorList } from "@/lib/pdf/image-boxes";

const opList = (fnArray: number[], argsArray: unknown[][]): ImageOperatorList => ({
  fnArray,
  argsArray,
});

describe("collectImageBoxes", () => {
  it("given a scaled transform before an image, records its placement", () => {
    const boxes = collectImageBoxes(
      opList([OPS.transform, OPS.paintImageXObject], [[100, 0, 0, 50, 200, 300], ["img"]]),
      1,
      OPS,
      Util,
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ page: 1, x: 200, y: 300, width: 100, height: 50 });
  });

  it("given a transform inside save/restore, does not leak it to the next image", () => {
    const boxes = collectImageBoxes(
      opList(
        [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject],
        [[], [100, 0, 0, 50, 200, 300], ["a"], [], ["b"]],
      ),
      2,
      OPS,
      Util,
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.id).toBe("2-0");
  });

  it("given an image smaller than the minimum, skips it", () => {
    const boxes = collectImageBoxes(
      opList([OPS.transform, OPS.paintImageXObject], [[10, 0, 0, 10, 0, 0], ["tiny"]]),
      1,
      OPS,
      Util,
    );

    expect(boxes).toHaveLength(0);
  });
});
