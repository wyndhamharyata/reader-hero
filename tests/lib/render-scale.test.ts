import { describe, expect, it } from "vitest";
import { pageRenderScale } from "@/lib/render-scale";

const letter = { width: 612, height: 792 };

describe("pageRenderScale", () => {
  it("given a letter page on a 3x phone, draws no softer than the old 1.5", () => {
    expect(pageRenderScale(letter, 374, 3)).toBe(1.8);
  });

  it("given a small novel page on a 3x phone, draws it sharp", () => {
    expect(pageRenderScale({ width: 360, height: 576 }, 374, 3)).toBe(3.1);
  });

  it("given a 1x screen, keeps 1x", () => {
    expect(pageRenderScale(letter, 400, 1)).toBe(1);
  });

  it("given a foldout, stays under the pixel cap", () => {
    const foldout = { width: 2384, height: 3370 };
    const scale = pageRenderScale(foldout, 768, 2);
    expect(foldout.width * scale * foldout.height * scale).toBeLessThanOrEqual(4_194_304);
  });

  it("given a width a few pixels off, keeps the same scale", () => {
    expect(pageRenderScale(letter, 741, 2)).toBe(pageRenderScale(letter, 745, 2));
  });
});
