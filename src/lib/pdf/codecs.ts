/**
 * Counts image/filter signatures in a raw PDF, so a slow figure pass can be
 * attributed to a specific codec. PDFs are scanned as Latin-1 text in chunks:
 * signature strings are ASCII and one byte per character in that encoding.
 */
const NEEDLES: ReadonlyArray<readonly [string, string]> = [
  ["DCT", "DCTDecode"],
  ["JPX", "JPXDecode"],
  ["JBIG2", "JBIG2Decode"],
  ["CCITT", "CCITTFaxDecode"],
  ["CMYK", "DeviceCMYK"],
  ["ICC", "ICCBased"],
  ["CalRGB", "CalRGB"],
  ["SMask", "SMask"],
];

const MAX_NEEDLE_LENGTH = 16;
const CHUNK = 1 << 20;
/** Hard cap so a pathological file cannot hang the scan. */
const SCAN_LIMIT = 512 << 20;
const MAX_HITS = 9999;

const countWithin = (text: string, needle: string, limit: number): number => {
  let count = 0;
  let at = 0;
  for (;;) {
    const found = text.indexOf(needle, at);
    if (found < 0 || found >= limit) return count;
    count += 1;
    if (count >= MAX_HITS) return count;
    at = found + 1;
  }
};

export function scanCodecs(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const decoder = new TextDecoder("latin1");
  const counts = new Map<string, number>(NEEDLES.map(([label]) => [label, 0]));

  let from = 0;
  while (from < bytes.length && from < SCAN_LIMIT) {
    const end = Math.min(bytes.length, from + CHUNK);
    // Include a small tail so signatures straddling a chunk boundary still match.
    const text = decoder.decode(bytes.subarray(from, Math.min(bytes.length, end + MAX_NEEDLE_LENGTH)));
    for (const [label, needle] of NEEDLES) {
      counts.set(label, (counts.get(label) ?? 0) + countWithin(text, needle, end - from));
    }
    from = end;
  }

  return NEEDLES.map(([label]) => `${label}:${counts.get(label) ?? 0}`).join(" ");
}
