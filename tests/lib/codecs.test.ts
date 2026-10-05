import { describe, expect, it } from "vitest";
import { scanCodecs } from "@/lib/pdf/codecs";

const document = (...parts: string[]): ArrayBuffer => {
  const bytes = new TextEncoder().encode(parts.join(""));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("scanCodecs", () => {
  it("counts codec signatures", () => {
    const data = document("/Filter /DCTDecode", "/Filter /DCTDecode", "/DeviceCMYK", "/JPXDecode");
    expect(scanCodecs(data)).toBe("DCT:2 JPX:1 JBIG2:0 CCITT:0 CMYK:1 ICC:0 CalRGB:0 SMask:0");
  });

  it("matches a signature straddling the chunk boundary", () => {
    const prefix = "/Filler".repeat(200000); // push near the 1MB boundary
    const data = document(prefix, "/DeviceC", "MYK /X");
    expect(scanCodecs(data)).toContain("CMYK:1");
  });

  it("returns zero counts for a pdf without images", () => {
    expect(scanCodecs(document("nothing here"))).toBe(
      "DCT:0 JPX:0 JBIG2:0 CCITT:0 CMYK:0 ICC:0 CalRGB:0 SMask:0",
    );
  });
});
