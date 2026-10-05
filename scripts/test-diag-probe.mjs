// Verifies the probe logic inside public/diag.html verbatim: loads the inline
// script, stubs the DOM, and runs extraction + header parsing against a
// synthetic PDF with two JPEG plates (clean + junk-prefixed).
import { readFileSync } from "node:fs";

const html = readFileSync("public/diag.html", "utf8");
const match = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!match) {
  console.error("no inline script found");
  process.exit(1);
}

const stubs = `
  const document = { getElementById: () => ({ addEventListener() {}, disabled: false }) };
  const location = { search: "" };
  const fetch = () => Promise.resolve();
  const URL = { createObjectURL: () => "" };
  const Worker = class { postMessage() {} };
  const Blob = class {};
  globalThis.__exports = {};
`;
const body = match[1]
  .replace(/const file = document\.gotcha/, "const file = null") // no-op safeguard
  .replace(/^.*$/m, (line) => line); // keep as is

const context = new Function(
  `${stubs}
  ${match[1]}
  return { extractJpegs, jpegShape };`,
)();

// A minimal JPEG header: SOI, APP14 Adobe transform=0, SOF0 1403x2000 3 comps.
const plate = (transform) => {
  const bytes = [];
  const push = (...items) => bytes.push(...items.flat());
  push(0xff, 0xd8); // SOI
  push(0xff, 0xee); // APP14
  const adobe = [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, transform];
  push(((adobe.length + 2) >> 8) & 0xff, (adobe.length + 2) & 0xff, adobe);
  push(0xff, 0xc0); // SOF0
  const sof = [0x08, (2000 >> 8) & 0xff, 2000 & 0xff, (1403 >> 8) & 0xff, 1403 & 0xff, 0x03];
  push(((sof.length + 2) >> 8) & 0xff, (sof.length + 2) & 0xff, sof);
  push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
};

const junk = new Uint8Array(37).fill(0x20); // leading padding in a dirty dict

function buildPdf(...plates) {
  const parts = [];
  let index = 0;
  for (const plate of plates) {
    parts.push(`% plate ${index}\n<< /Filter /DCTDecode /Length ${plate.length} >>\nstream\n`);
    parts.push(plate);
    parts.push("\nendstream\n");
    index += 1;
  }
  const chunks = parts.map((part) =>
    typeof part === "string" ? new TextEncoder().encode(part) : part,
  );
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const bytes = buildPdf(plate(0), plate(1));
const wrapped = new Uint8Array(junk.length + 11 + plate(0).length);
wrapped.set(junk, 0);
wrapped.set(plate(0), junk.length + 11); // stream\n + junk before SOI

const found = context.extractJpegs(
  (() => {
    // The finder scans latin1 text; feed it a pdf containing the dirty plate only.
    return buildPdf(
      (() => {
        const dirty = new Uint8Array(junk.length + plate(0).length);
        dirty.set(junk, 0);
        dirty.set(plate(0), junk.length);
        return dirty;
      })(),
    );
  })(),
);

console.log("extracted plates:", found.length);
for (const [index, candidate] of found.entries()) {
  const shape = context.jpegShape(candidate);
  console.log(
    `plate ${index}: ${candidate.length}B ${shape.width}x${shape.height} comps=${shape.components} adobe=${shape.adobe} prog=${shape.progressive} exif=${shape.exif} so@${shape.offset}`,
  );
}

const cleanShape = context.jpegShape(plate(0));
const ok =
  found.length === 1 &&
  cleanShape.width === 1403 &&
  cleanShape.height === 2000 &&
  cleanShape.components === 3 &&
  cleanShape.adobe === 0;

console.log(ok ? "DIAG-PROBE TEST OK" : "DIAG-PROBE TEST FAILED");
process.exit(ok ? 0 : 1);
