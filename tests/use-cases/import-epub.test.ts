// @vitest-environment jsdom
import { Effect, Exit } from "effect";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpub } from "@/use-cases/import-epub";
import { bookStore } from "../_support/book-store";

const epub = (extra: Record<string, Uint8Array>) =>
  zipSync({
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Small</dc:title></metadata>
  <manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="one"/></spine>
</package>`),
    "OEBPS/one.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head>
<body><p>A short chapter.</p></body></html>`),
    ...extra,
  });

const build = (zip: Uint8Array) =>
  Effect.runPromiseExit(
    buildEpub("b1", zip.buffer as ArrayBuffer, () => {}).pipe(Effect.provide(bookStore({}))),
  );

describe("buildEpub", () => {
  it("given a small book, builds it", async () => {
    expect(Exit.isSuccess(await build(epub({})))).toBe(true);
  });

  it("given a file that inflates past the limit, fails instead of inflating it", async () => {
    // 80 MB of zeros packs to a few hundred KB, as a zip bomb's entries do.
    const exit = await build(epub({ "OEBPS/huge.css": new Uint8Array(80 * 1024 * 1024) }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("EpubFailure");
  });
});
