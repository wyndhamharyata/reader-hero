import { Effect, Option, Stream } from "effect";
import { Block, PARSED_VERSION, ParsedBook, TocEntry } from "@/domain/book";
import { EpubFailure } from "@/domain/errors";
import { blockLink } from "@/lib/links";
import { trimTextRanges } from "@/lib/text-ranges";

export interface EpubBook {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly series?: string;
  readonly seriesNumber?: number;
  readonly parsed: ParsedBook;
  readonly images: ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly type: string;
  }>;
  readonly cover: EpubBook["images"][number] | null;
}

type Style = {
  readonly isBold?: boolean;
  readonly isItalic?: boolean;
  readonly href?: string;
};

const INTERNAL_LINK_PREFIX = "epub:";

const blockNames = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);
const skipNames = new Set(["head", "noscript", "rp", "rt", "script", "style", "title"]);
const italicNames = new Set(["cite", "dfn", "em", "i", "var"]);
// Font obfuscation hides embedded fonts only. Any other algorithm means the text itself is encrypted.
const fontObfuscation = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

// Hrefs are relative to the file that holds them and URL-encoded. Zip paths are neither.
function resolve(dir: string, href: string): string {
  const raw = href.split("#")[0] ?? "";
  // A malformed escape stays as written.
  const decoded = Option.getOrElse(Option.liftThrowable(decodeURIComponent)(raw), () => raw);
  const parts = dir.split("/").filter((part) => part !== "");

  for (const part of decoded.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }

  return parts.join("/");
}

// A file and fragment, as the anchors map keys them.
function resolveTarget(path: string, href: string): string {
  const hash = href.indexOf("#");
  const file = hash < 0 ? href : href.slice(0, hash);
  const rawFragment = hash < 0 ? "" : href.slice(hash + 1);
  const fragment = Option.getOrElse(
    Option.liftThrowable(decodeURIComponent)(rawFragment),
    () => rawFragment,
  );
  const base = file === "" ? path : resolve(path.slice(0, path.lastIndexOf("/") + 1), file);

  return fragment === "" ? base : `${base}#${fragment}`;
}

function hasExternalScheme(href: string): boolean {
  const lower = href.toLowerCase();

  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  );
}

function readLink(path: string, value: string | null): string | undefined {
  const href = value?.trim() ?? "";
  const lower = href.toLowerCase();

  if (href === "" || lower.startsWith("javascript:") || lower.startsWith("data:")) return undefined;
  if (href.startsWith("//")) return `https:${href}`;
  if (hasExternalScheme(href)) return href;

  return `${INTERNAL_LINK_PREFIX}${resolveTarget(path, href)}`;
}

// Two consumers (stylesheet rules and style attributes) share this parser.
function readStyle(declarations: string): Style {
  let isBold: boolean | undefined;
  let isItalic: boolean | undefined;

  for (const declaration of declarations.split(";")) {
    const colon = declaration.indexOf(":");

    if (colon < 0) continue;

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace("!important", "")
      .trim()
      .toLowerCase();

    if (property === "font-style") isItalic = value === "italic" || value === "oblique";

    if (property === "font-weight") {
      isBold = value === "bold" || value === "bolder" || Number(value) >= 600;
    }
  }

  return { isBold, isItalic };
}

function hasDrm(
  read: (path: string) => string | null,
  parse: (path: string, type: DOMParserSupportedType) => Document | null,
): boolean {
  if (read("META-INF/sinf.xml") !== null) return true;

  const encryption = parse("META-INF/encryption.xml", "application/xml");

  for (const method of encryption?.getElementsByTagNameNS("*", "EncryptionMethod") ?? []) {
    if (!fontObfuscation.has(method.getAttribute("Algorithm") ?? "")) return true;
  }

  return false;
}

function isFixedLayout(metadataTags: ReadonlyArray<Element>): boolean {
  return metadataTags.some(
    (meta) =>
      meta.getAttribute("property") === "rendition:layout" &&
      meta.textContent?.trim() === "pre-paginated",
  );
}

function readItems(
  opf: Document,
  opfDir: string,
): {
  readonly items: Map<string, EpubItem>;
  readonly types: Map<string, string>;
} {
  const items = new Map<string, EpubItem>();
  const types = new Map<string, string>();

  for (const item of opf.getElementsByTagNameNS("*", "item")) {
    const path = resolve(opfDir, item.getAttribute("href") ?? "");
    const type = item.getAttribute("media-type") ?? "";

    types.set(path, type);
    items.set(item.getAttribute("id") ?? "", {
      path,
      type,
      properties: item.getAttribute("properties") ?? "",
    });
  }

  return { items, types };
}

function readSpine(opf: Document, items: ReadonlyMap<string, EpubItem>): Array<string> {
  const spine: Array<string> = [];

  for (const reference of opf.getElementsByTagNameNS("*", "itemref")) {
    const item = items.get(reference.getAttribute("idref") ?? "");

    if (item !== undefined) spine.push(item.path);
  }

  return spine;
}

function readClassStyles(
  items: ReadonlyMap<string, EpubItem>,
  read: (path: string) => string | null,
): Map<string, Style> {
  const classStyles = new Map<string, Style>();

  for (const item of items.values()) {
    if (item.type !== "text/css") continue;

    let css = read(item.path) ?? "";

    for (let open = css.indexOf("/*"); open >= 0; open = css.indexOf("/*")) {
      const close = css.indexOf("*/", open + 2);

      css = css.slice(0, open) + (close < 0 ? "" : css.slice(close + 2));
    }

    for (const rule of css.split("}")) {
      const open = rule.lastIndexOf("{");

      if (open < 0) continue;

      const style = readStyle(rule.slice(open + 1));

      if (style.isBold === undefined && style.isItalic === undefined) continue;

      // The text after the last "{" drops an enclosing "@media … {".
      const head = rule.slice(0, open);

      for (const selector of head.slice(head.lastIndexOf("{") + 1).split(",")) {
        const last = selector.trim().split(" ").at(-1) ?? "";
        const dot = last.lastIndexOf(".");

        if (dot < 0) continue;

        const name =
          last
            .slice(dot + 1)
            .split(":")[0]
            ?.split("[")[0] ?? "";

        if (name !== "") classStyles.set(name, { ...classStyles.get(name), ...style });
      }
    }
  }

  return classStyles;
}

interface EpubItem {
  readonly path: string;
  readonly type: string;
  readonly properties: string;
}

function readContents(
  items: ReadonlyMap<string, EpubItem>,
  parse: (path: string, type: DOMParserSupportedType) => Document | null,
): Array<{ title: string; target: string; depth: number }> {
  const contents: Array<{ title: string; target: string; depth: number }> = [];
  const navItem = [...items.values()].find((item) => item.properties.split(" ").includes("nav"));
  const nav = navItem === undefined ? null : parse(navItem.path, "application/xhtml+xml");

  if (navItem !== undefined && nav !== null) {
    const navs = [...nav.getElementsByTagNameNS("*", "nav")];
    const toc =
      navs.find((element) =>
        (element.getAttribute("epub:type") ?? "").split(" ").includes("toc"),
      ) ?? navs[0];
    const navDir = navItem.path.slice(0, navItem.path.lastIndexOf("/") + 1);
    const visit = (list: Element, depth: number): void => {
      for (const entry of list.children) {
        if (entry.localName !== "li") continue;

        for (const part of entry.children) {
          const href = part.getAttribute("href");

          if (part.localName === "a" && href !== null) {
            const fragment = href.split("#")[1];
            const file = resolve(navDir, href);

            contents.push({
              title: part.textContent?.trim() ?? "",
              target: fragment === undefined ? file : `${file}#${fragment}`,
              depth,
            });
          }

          if (part.localName === "ol" || part.localName === "ul") visit(part, depth + 1);
        }
      }
    };
    const list = [...(toc?.children ?? [])].find((element) => element.localName === "ol");

    if (list !== undefined) visit(list, 0);
  }

  const ncxItem = [...items.values()].find((item) => item.type === "application/x-dtbncx+xml");
  const ncx =
    contents.length > 0 || ncxItem === undefined ? null : parse(ncxItem.path, "application/xml");

  if (ncxItem !== undefined && ncx !== null) {
    const ncxDir = ncxItem.path.slice(0, ncxItem.path.lastIndexOf("/") + 1);
    const visit = (parent: Element, depth: number): void => {
      for (const point of parent.children) {
        if (point.localName !== "navPoint") continue;

        const source = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src") ?? "";
        const fragment = source.split("#")[1];
        const file = resolve(ncxDir, source);

        contents.push({
          title: point.getElementsByTagNameNS("*", "text")[0]?.textContent?.trim() ?? "",
          target: fragment === undefined ? file : `${file}#${fragment}`,
          depth,
        });
        visit(point, depth + 1);
      }
    };
    const map = ncx.getElementsByTagNameNS("*", "navMap")[0];

    if (map !== undefined) visit(map, 0);
  }

  return contents;
}

function coverOf(
  items: ReadonlyMap<string, EpubItem>,
  images: ReadonlyArray<{ readonly id: string; readonly path: string; readonly type: string }>,
  opf: Document,
): { readonly id: string; readonly path: string; readonly type: string } | null {
  const named = opf.querySelector("meta[name='cover']")?.getAttribute("content");
  const coverItem =
    [...items.values()].find((item) => item.properties.split(" ").includes("cover-image")) ??
    items.get(named ?? "");

  if (coverItem !== undefined && coverItem.type.startsWith("image/")) {
    return { id: "cover", path: coverItem.path, type: coverItem.type };
  }

  return images[0] === undefined ? null : { ...images[0], id: "cover" };
}

function readMetadata(
  opf: Document,
  metadataTags: ReadonlyArray<Element>,
): {
  readonly title: string | undefined;
  readonly author: string | undefined;
  readonly subject: string | undefined;
  readonly series: string | undefined;
  readonly seriesNumber: number | undefined;
} {
  const metadata = (name: string): ReadonlyArray<string> =>
    [...opf.getElementsByTagNameNS("*", name)]
      .map((element) => element.textContent?.trim() ?? "")
      .filter((value) => value !== "");
  const collections = metadataTags.filter(
    (meta) => meta.getAttribute("property") === "belongs-to-collection",
  );
  const collection =
    collections.find((meta) => {
      const id = meta.getAttribute("id");

      return (
        id !== null &&
        metadataTags.some(
          (refined) =>
            refined.getAttribute("refines") === `#${id}` &&
            refined.getAttribute("property") === "group-position",
        )
      );
    }) ?? collections[0];
  const epubSeries = collection?.textContent?.trim() || undefined;
  const collectionId = collection?.getAttribute("id");
  const groupPosition =
    collectionId === null || collectionId === undefined
      ? undefined
      : metadataTags
          .find(
            (meta) =>
              meta.getAttribute("refines") === `#${collectionId}` &&
              meta.getAttribute("property") === "group-position",
          )
          ?.textContent?.trim();
  const calibreSeries =
    metadataTags
      .find((meta) => meta.getAttribute("name") === "calibre:series")
      ?.getAttribute("content")
      ?.trim() || undefined;
  const calibreSeriesNumber = metadataTags
    .find((meta) => meta.getAttribute("name") === "calibre:series_index")
    ?.getAttribute("content")
    ?.trim();
  const series = epubSeries ?? calibreSeries;
  const seriesNumberText =
    series === undefined ? undefined : (groupPosition ?? calibreSeriesNumber);
  const parsedSeriesNumber =
    seriesNumberText === undefined || seriesNumberText === ""
      ? undefined
      : Number(seriesNumberText);

  return {
    title: metadata("title")[0],
    author: metadata("creator")[0],
    subject: metadata("subject").join(", ") || undefined,
    series,
    seriesNumber: Number.isFinite(parsedSeriesNumber) ? parsedSeriesNumber : undefined,
  };
}

type Mark = NonNullable<Block["marks"]>[number];

interface ChapterState {
  text: string;
  marks: Array<Mark>;
  level: number;
  page: number;
  readonly blocks: Array<Block>;
  readonly anchors: Map<string, number>;
  readonly imageIds: Map<string, string>;
  readonly classStyles: ReadonlyMap<string, Style>;
}

function flushChapter(state: ChapterState): void {
  const body = state.text.trim();

  if (body !== "") {
    const kept = trimTextRanges(state.text, state.marks);

    state.blocks.push(
      new Block({
        kind: state.level > 0 ? "heading" : "paragraph",
        level: state.level,
        text: body,
        page: state.page,
        marks: kept.length > 0 ? kept : undefined,
      }),
    );
  }

  state.text = "";
  state.marks = [];
}

function walkChapter(node: Node, style: Style, path: string, state: ChapterState): void {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      appendText(child, style, state);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    appendElement(child as Element, style, path, state);
  }
}

function appendText(node: Node, style: Style, state: ChapterState): void {
  const from = state.text.length;

  // Collapse the source's whitespace the way a browser would. No-break spaces stay.
  for (const char of node.nodeValue ?? "") {
    if (" \n\t\r\f".includes(char)) {
      if (state.text !== "" && !state.text.endsWith(" ")) state.text += " ";
    } else {
      state.text += char;
    }
  }

  if (state.text.length > from && style.isBold === true) {
    state.marks.push({ start: from, end: state.text.length, style: "bold" });
  }

  if (state.text.length > from && style.isItalic === true) {
    state.marks.push({ start: from, end: state.text.length, style: "italic" });
  }

  if (state.text.length > from && style.href !== undefined) {
    state.marks.push({ start: from, end: state.text.length, style: "link", href: style.href });
  }
}

function isHeadingName(name: string): boolean {
  return name.length === 2 && name.startsWith("h") && "123456".includes(name[1] ?? "");
}

function isImageName(name: string): boolean {
  return name === "img" || name === "image";
}

function isBlockName(name: string): boolean {
  return isHeadingName(name) || isImageName(name) || blockNames.has(name);
}

function appendElement(element: Element, style: Style, path: string, state: ChapterState): void {
  const name = element.localName.toLowerCase();

  if (skipNames.has(name)) return;

  if (name === "br") {
    if (state.text !== "" && !state.text.endsWith(" ")) state.text += " ";
    return;
  }

  const heading = isHeadingName(name);
  const image = isImageName(name);

  if (isBlockName(name)) flushChapter(state);

  // A block element flushed first, so the next block pushed is the one this id names.
  const id = element.getAttribute("id") ?? element.getAttribute("name");

  if (id !== null) state.anchors.set(`${path}#${id}`, state.blocks.length);

  if (image) {
    appendImage(element, path, state);
    return;
  }

  const next = elementStyle(element, style, state.classStyles, path);

  if (heading) state.level = Math.min(3, Number(name[1]));
  walkChapter(element, next, path, state);
  if (isBlockName(name)) flushChapter(state);
  if (heading) state.level = 0;
}

function appendImage(element: Element, path: string, state: ChapterState): void {
  const source =
    element.getAttribute("src") ??
    element.getAttribute("href") ??
    element.getAttribute("xlink:href");

  if (source === null) return;

  const target = resolve(path.slice(0, path.lastIndexOf("/") + 1), source);
  const imageId = state.imageIds.get(target) ?? `epub-${state.imageIds.size + 1}`;

  state.imageIds.set(target, imageId);
  state.blocks.push(new Block({ kind: "image", level: 0, text: "", page: state.page, imageId }));
}

function elementStyle(
  element: Element,
  style: Style,
  classStyles: ReadonlyMap<string, Style>,
  path: string,
): Style {
  let isBold = style.isBold === true || element.localName === "b" || element.localName === "strong";
  let isItalic = style.isItalic === true || italicNames.has(element.localName);
  const href =
    element.localName === "a"
      ? (readLink(path, element.getAttribute("href")) ?? style.href)
      : style.href;

  for (const className of (element.getAttribute("class") ?? "").split(" ")) {
    const own = classStyles.get(className);

    isBold = own?.isBold ?? isBold;
    isItalic = own?.isItalic ?? isItalic;
  }

  const inline = readStyle(element.getAttribute("style") ?? "");

  return { isBold: inline.isBold ?? isBold, isItalic: inline.isItalic ?? isItalic, href };
}

function buildToc(
  contents: ReadonlyArray<{
    readonly title: string;
    readonly target: string;
    readonly depth: number;
  }>,
  anchors: ReadonlyMap<string, number>,
  blocks: Array<Block>,
): Array<TocEntry> {
  const toc: Array<TocEntry> = [];

  for (const entry of contents) {
    const index = anchors.get(entry.target) ?? anchors.get(entry.target.split("#")[0] ?? "");
    const block = index === undefined ? undefined : blocks[index];

    if (index === undefined || block === undefined || entry.title === "") continue;

    // Books often style chapter titles as bold paragraphs. Spaces differ around a <br/>.
    const title = entry.title.toLowerCase().replaceAll(" ", "");
    const opening = block.text.toLowerCase().replaceAll(" ", "");

    if (block.kind === "paragraph" && block.text.length <= 120 && opening.startsWith(title)) {
      blocks[index] = new Block({
        ...block,
        kind: "heading",
        level: Math.min(3, entry.depth + 2),
      });
    }

    toc.push(
      new TocEntry({
        title: entry.title,
        page: block.page,
        blockIndex: index,
        depth: entry.depth,
      }),
    );
  }

  return toc;
}

function resolveBlockLinks(blocks: Array<Block>, anchors: ReadonlyMap<string, number>): void {
  for (const [index, block] of blocks.entries()) {
    if (block.marks === undefined) continue;

    const marks: Array<Mark> = [];
    let changed = false;

    for (const mark of block.marks) {
      const isInternal =
        mark.style === "link" &&
        mark.href !== undefined &&
        mark.href.startsWith(INTERNAL_LINK_PREFIX);
      const target = isInternal
        ? anchors.get((mark.href ?? "").slice(INTERNAL_LINK_PREFIX.length))
        : undefined;

      if (!isInternal) marks.push(mark);
      else {
        changed = true;
        if (target !== undefined) marks.push({ ...mark, href: blockLink(target) });
      }
    }

    if (changed)
      blocks[index] = new Block({ ...block, marks: marks.length > 0 ? marks : undefined });
  }
}

export function parseEpub(
  files: Readonly<Record<string, Uint8Array>>,
  onChapter: (done: number, total: number) => void,
): Effect.Effect<EpubBook, EpubFailure> {
  return Effect.gen(function* () {
    const decoder = new TextDecoder();
    const read = (path: string): string | null => {
      const bytes = files[path];
      return bytes === undefined ? null : decoder.decode(bytes);
    };
    const parse = (path: string, type: DOMParserSupportedType): Document | null => {
      const source = read(path);

      if (source === null) return null;

      const parsed = new DOMParser().parseFromString(source, type);

      if (parsed.getElementsByTagName("parsererror").length === 0) return parsed;

      // Many books ship loose XHTML. The HTML parser accepts it.
      return type === "application/xml"
        ? null
        : new DOMParser().parseFromString(source, "text/html");
    };
    const corrupt = new EpubFailure({ reason: "corrupt" });

    if (hasDrm(read, parse)) return yield* new EpubFailure({ reason: "drm" });

    const container = parse("META-INF/container.xml", "application/xml");
    const opfPath = container
      ?.getElementsByTagNameNS("*", "rootfile")[0]
      ?.getAttribute("full-path");

    if (opfPath === null || opfPath === undefined) return yield* corrupt;

    const opf = parse(opfPath, "application/xml");

    if (opf === null) return yield* corrupt;

    const opfDir = opfPath.slice(0, opfPath.lastIndexOf("/") + 1);

    const metadataTags = [...opf.getElementsByTagNameNS("*", "meta")];

    if (isFixedLayout(metadataTags)) {
      return yield* new EpubFailure({ reason: "fixed-layout" });
    }

    const { items, types } = readItems(opf, opfDir);
    const spine = readSpine(opf, items);

    if (spine.length === 0) return yield* corrupt;

    const classStyles = readClassStyles(items, read);

    const blocks: Array<Block> = [];
    const anchors = new Map<string, number>();
    const imageIds = new Map<string, string>();
    const state: ChapterState = {
      text: "",
      marks: [],
      level: 0,
      page: 0,
      blocks,
      anchors,
      imageIds,
      classStyles,
    };

    yield* Stream.fromIterable(spine.entries()).pipe(
      Stream.tap(([index, path]) =>
        Effect.sync(() => {
          state.page = index + 1;
          state.anchors.set(path, state.blocks.length);

          const chapter = parse(path, "application/xhtml+xml");
          const body = chapter?.getElementsByTagNameNS("*", "body")[0];

          if (body !== undefined) walkChapter(body, {}, path, state);
          flushChapter(state);
          onChapter(state.page, spine.length);
        }),
      ),
      // Lets the progress panel paint between chapters.
      Stream.tap(() => Effect.yieldNow),
      Stream.runDrain,
    );

    resolveBlockLinks(blocks, anchors);

    const contents = readContents(items, parse);

    const toc = buildToc(contents, anchors, blocks);

    const images = [...imageIds].map(([path, id]) => ({ id, path, type: types.get(path) ?? "" }));
    const cover = coverOf(items, images, opf);
    const { title, author, subject, series, seriesNumber } = readMetadata(opf, metadataTags);
    const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0);

    return {
      title,
      author,
      subject,
      series,
      seriesNumber,
      images,
      cover,
      parsed: new ParsedBook({
        version: PARSED_VERSION,
        // An EPUB has no pages. About 1,800 characters fill a printed novel page.
        pageCount: Math.max(1, Math.round(charCount / 1800)),
        charCount,
        blocks,
        toc,
        figuresThrough: 0,
      }),
    };
  });
}
