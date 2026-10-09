// @vitest-environment jsdom
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseEpub } from "@/lib/epub/parse";

const encode = (files: Record<string, string>): Record<string, Uint8Array> =>
  Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );

const container = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const opf = (metadata = "", manifest = "") => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Book</dc:title>
    <dc:creator>Ann Author</dc:creator>
    <dc:subject>fantasy</dc:subject>
    <dc:subject>light novel</dc:subject>
    ${metadata}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
    <item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="Text/chapter%20two.xhtml" media-type="application/xhtml+xml"/>
    <item id="art" href="Images/art.jpg" media-type="image/jpeg" properties="cover-image"/>
    ${manifest}
  </manifest>
  <spine><itemref idref="one"/><itemref idref="two"/></spine>
</package>`;

const page = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>x</title></head><body>${body}</body></html>`;

const book = (overrides: Record<string, string> = {}) =>
  encode({
    "META-INF/container.xml": container,
    "OEBPS/content.opf": opf(),
    "OEBPS/Styles/book.css": `/* house style */
      p.quote, .aside { font-style: italic; }
      @media screen { .loud { font-weight: 700 } }
      .plain { font-style: normal }`,
    "OEBPS/nav.xhtml": page(`<nav epub:type="toc"><ol>
      <li><a href="Text/one.xhtml">Opening</a></li>
      <li><a href="Text/chapter%20two.xhtml#start">Chapter 2:<br/>The Road</a>
        <ol><li><a href="Text/chapter%20two.xhtml#later">Later</a></li></ol></li>
    </ol></nav>`),
    "OEBPS/Text/one.xhtml": page(`<h1>Opening</h1>
      <img src="../Images/art.jpg"/>
      <p>She read <em>The   Long
        Night</em> and <b>stopped</b>.</p>
      <p class="quote">A quoted line with <span class="plain">plain</span> words.</p>
      <p>&#160;</p>`),
    "OEBPS/Text/chapter two.xhtml":
      page(`<p id="start"><span style="font-weight: bold">Chapter 2:<br/>The Road</span></p>
      <p>Some <span class="loud">loud</span> and <span style=" font-style: italic;">quiet</span> text.</p>
      <div id="later"><p>Time passed.</p></div>
      <p><img src="../Images/art.jpg"/></p>`),
    ...overrides,
  });

const run = (files: Record<string, Uint8Array>) => Effect.runSync(parseEpub(files, () => {}));
const failure = (files: Record<string, Uint8Array>) =>
  Effect.runSync(Effect.flip(parseEpub(files, () => {})));

describe("parseEpub", () => {
  it("given a package, reads the title, author, and subjects", () => {
    const result = run(book());

    expect(result.title).toBe("The Book");
    expect(result.author).toBe("Ann Author");
    expect(result.subject).toBe("fantasy, light novel");
    expect(result.series).toBeUndefined();
    expect(result.seriesNumber).toBeUndefined();
  });

  it("given Calibre series metadata, reads its name and numeric place", () => {
    const files = book({
      "OEBPS/content.opf": opf(
        '<meta name="calibre:series" content="The Tide Cycle"/><meta name="calibre:series_index" content="2.5"/>',
      ),
    });

    expect(run(files)).toMatchObject({ series: "The Tide Cycle", seriesNumber: 2.5 });
  });

  it("given EPUB 3 collection metadata, reads its group position", () => {
    const files = book({
      "OEBPS/content.opf": opf(
        '<meta id="cycle" property="belongs-to-collection">The Tide Cycle</meta><meta refines="#cycle" property="group-position">3</meta>',
      ),
    });

    expect(run(files)).toMatchObject({ series: "The Tide Cycle", seriesNumber: 3 });
  });

  it("given spine pages, builds blocks in reading order with collapsed whitespace", () => {
    const blocks = run(book()).parsed.blocks;

    expect(blocks.map((block) => [block.kind, block.text, block.page])).toEqual([
      ["heading", "Opening", 1],
      ["image", "", 1],
      ["paragraph", "She read The Long Night and stopped.", 1],
      ["paragraph", "A quoted line with plain words.", 1],
      ["heading", "Chapter 2: The Road", 2],
      ["paragraph", "Some loud and quiet text.", 2],
      ["paragraph", "Time passed.", 2],
      ["image", "", 2],
    ]);
  });

  it("given em, b, classes, and style attributes, marks bold and italic ranges", () => {
    const blocks = run(book()).parsed.blocks;

    expect(blocks[2]?.marks).toEqual([
      { start: 9, end: 23, style: "italic" },
      { start: 28, end: 35, style: "bold" },
    ]);
    // The class turns italic off for "plain", so the line has two italic runs around it.
    expect(blocks[3]?.marks).toEqual([
      { start: 0, end: 19, style: "italic" },
      { start: 24, end: 31, style: "italic" },
    ]);
    expect(blocks[5]?.marks).toEqual([
      { start: 5, end: 9, style: "bold" },
      { start: 14, end: 19, style: "italic" },
    ]);
  });

  it("given a nav document, links entries to blocks and promotes the bold title to a heading", () => {
    const parsed = run(book()).parsed;

    expect(parsed.toc.map((entry) => [entry.title, entry.blockIndex, entry.depth])).toEqual([
      ["Opening", 0, 0],
      ["Chapter 2:The Road", 4, 0],
      ["Later", 6, 1],
    ]);
    expect(parsed.blocks[4]?.level).toBe(2);
  });

  it("given no nav document, reads the contents from the NCX", () => {
    const ncx = `<?xml version="1.0"?>
      <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
        <navPoint><navLabel><text>Road</text></navLabel><content src="Text/chapter%20two.xhtml#start"/></navPoint>
      </navMap></ncx>`;
    const files = book({
      "OEBPS/content.opf": opf(
        "",
        `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      ).replace('properties="nav"', ""),
      "OEBPS/toc.ncx": ncx,
    });

    expect(run(files).parsed.toc.map((entry) => [entry.title, entry.blockIndex])).toEqual([
      ["Road", 4],
    ]);
  });

  it("given one image used twice, stores it once and takes the declared cover", () => {
    const result = run(book());

    expect(result.images).toEqual([
      { id: "epub-1", path: "OEBPS/Images/art.jpg", type: "image/jpeg" },
    ]);
    expect(result.parsed.blocks[7]?.imageId).toBe("epub-1");
    expect(result.cover).toEqual({ id: "cover", path: "OEBPS/Images/art.jpg", type: "image/jpeg" });
  });

  it("given encrypted content, fails as DRM", () => {
    const encryption = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
      <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
      </enc:EncryptedData></encryption>`;

    expect(failure(book({ "META-INF/encryption.xml": encryption })).reason).toBe("drm");
  });

  it("given only obfuscated fonts, still opens", () => {
    const encryption = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
      <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
      </enc:EncryptedData></encryption>`;

    expect(run(book({ "META-INF/encryption.xml": encryption })).title).toBe("The Book");
  });

  it("given a fixed-layout book, fails as fixed-layout", () => {
    const files = book({
      "OEBPS/content.opf": opf(`<meta property="rendition:layout">pre-paginated</meta>`),
    });

    expect(failure(files).reason).toBe("fixed-layout");
  });

  it("given no container, fails as corrupt", () => {
    expect(failure(encode({ mimetype: "application/epub+zip" })).reason).toBe("corrupt");
  });
});
