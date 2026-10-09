import { Effect, Option, Stream } from "effect";
import { Block, PARSED_VERSION, ParsedBook, TocEntry } from "@/domain/book";
import { EpubFailure } from "@/domain/errors";

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

type Style = { readonly bold?: boolean; readonly italic?: boolean };

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
// Font obfuscation hides embedded fonts only; any other algorithm means the text itself is encrypted.
const fontObfuscation = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

// Hrefs are relative to the file that holds them and URL-encoded; zip paths are neither.
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

// Judgement call: two consumers (stylesheet rules and style attributes) share this parser.
function readStyle(declarations: string): Style {
  let bold: boolean | undefined;
  let italic: boolean | undefined;
  for (const declaration of declarations.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace("!important", "")
      .trim()
      .toLowerCase();
    if (property === "font-style") italic = value === "italic" || value === "oblique";
    if (property === "font-weight") {
      bold = value === "bold" || value === "bolder" || Number(value) >= 600;
    }
  }
  return { bold, italic };
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
      const doc = new DOMParser().parseFromString(source, type);
      if (doc.getElementsByTagName("parsererror").length === 0) return doc;
      // Many books ship loose XHTML; the HTML parser accepts it.
      return type === "application/xml"
        ? null
        : new DOMParser().parseFromString(source, "text/html");
    };
    const corrupt = new EpubFailure({ reason: "corrupt" });

    if (read("META-INF/sinf.xml") !== null) return yield* new EpubFailure({ reason: "drm" });
    const encryption = parse("META-INF/encryption.xml", "application/xml");
    for (const method of encryption?.getElementsByTagNameNS("*", "EncryptionMethod") ?? []) {
      if (!fontObfuscation.has(method.getAttribute("Algorithm") ?? "")) {
        return yield* new EpubFailure({ reason: "drm" });
      }
    }

    const container = parse("META-INF/container.xml", "application/xml");
    const opfPath = container
      ?.getElementsByTagNameNS("*", "rootfile")[0]
      ?.getAttribute("full-path");
    if (opfPath === null || opfPath === undefined) return yield* corrupt;
    const opf = parse(opfPath, "application/xml");
    if (opf === null) return yield* corrupt;
    const opfDir = opfPath.slice(0, opfPath.lastIndexOf("/") + 1);

    const metadataTags = [...opf.getElementsByTagNameNS("*", "meta")];
    for (const meta of metadataTags) {
      if (
        meta.getAttribute("property") === "rendition:layout" &&
        meta.textContent?.trim() === "pre-paginated"
      ) {
        return yield* new EpubFailure({ reason: "fixed-layout" });
      }
    }

    const items = new Map<string, { path: string; type: string; properties: string }>();
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
    const spine: string[] = [];
    for (const ref of opf.getElementsByTagNameNS("*", "itemref")) {
      const item = items.get(ref.getAttribute("idref") ?? "");
      if (item !== undefined) spine.push(item.path);
    }
    if (spine.length === 0) return yield* corrupt;

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
        if (style.bold === undefined && style.italic === undefined) continue;
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

    const blocks: Block[] = [];
    const anchors = new Map<string, number>();
    const imageIds = new Map<string, string>();
    let text = "";
    let marks: Array<NonNullable<Block["marks"]>[number]> = [];
    let level = 0;
    let page = 0;

    const flush = (): void => {
      const lead = text.length - text.trimStart().length;
      const body = text.trim();
      if (body !== "") {
        const kept = marks
          .map((mark) => ({
            ...mark,
            start: Math.max(0, mark.start - lead),
            end: Math.min(body.length, mark.end - lead),
          }))
          .filter((mark) => mark.end > mark.start);
        blocks.push(
          new Block({
            kind: level > 0 ? "heading" : "paragraph",
            level,
            text: body,
            page,
            marks: kept.length > 0 ? kept : undefined,
          }),
        );
      }
      text = "";
      marks = [];
    };

    const walk = (node: Node, style: Style, path: string): void => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
          const from = text.length;
          // Collapse the source's whitespace the way a browser would; no-break spaces stay.
          for (const char of child.nodeValue ?? "") {
            if (" \n\t\r\f".includes(char)) {
              if (text !== "" && !text.endsWith(" ")) text += " ";
            } else {
              text += char;
            }
          }
          if (text.length > from && style.bold === true) {
            marks.push({ start: from, end: text.length, style: "bold" });
          }
          if (text.length > from && style.italic === true) {
            marks.push({ start: from, end: text.length, style: "italic" });
          }
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const element = child as Element;
        const name = element.localName.toLowerCase();
        if (skipNames.has(name)) continue;
        if (name === "br") {
          if (text !== "" && !text.endsWith(" ")) text += " ";
          continue;
        }

        const heading =
          name.length === 2 && name.startsWith("h") && "123456".includes(name[1] ?? "");
        const image = name === "img" || name === "image";
        if (heading || image || blockNames.has(name)) flush();
        // A block element flushed first, so the next block pushed is the one this id names.
        const id = element.getAttribute("id");
        if (id !== null) anchors.set(`${path}#${id}`, blocks.length);

        if (image) {
          const src =
            element.getAttribute("src") ??
            element.getAttribute("href") ??
            element.getAttribute("xlink:href");
          if (src === null) continue;
          const target = resolve(path.slice(0, path.lastIndexOf("/") + 1), src);
          const imageId = imageIds.get(target) ?? `epub-${imageIds.size + 1}`;
          imageIds.set(target, imageId);
          blocks.push(new Block({ kind: "image", level: 0, text: "", page, imageId }));
          continue;
        }

        let bold = style.bold === true || name === "b" || name === "strong";
        let italic = style.italic === true || italicNames.has(name);
        for (const className of (element.getAttribute("class") ?? "").split(" ")) {
          const own = classStyles.get(className);
          bold = own?.bold ?? bold;
          italic = own?.italic ?? italic;
        }
        const inline = readStyle(element.getAttribute("style") ?? "");
        const next = { bold: inline.bold ?? bold, italic: inline.italic ?? italic };

        if (heading) level = Math.min(3, Number(name[1]));
        walk(element, next, path);
        if (heading || blockNames.has(name)) flush();
        if (heading) level = 0;
      }
    };

    yield* Stream.fromIterable(spine.entries()).pipe(
      Stream.tap(([index, path]) =>
        Effect.sync(() => {
          page = index + 1;
          anchors.set(path, blocks.length);
          const doc = parse(path, "application/xhtml+xml");
          const body = doc?.getElementsByTagNameNS("*", "body")[0];
          if (body !== undefined) walk(body, {}, path);
          flush();
          onChapter(page, spine.length);
        }),
      ),
      // Lets the progress panel paint between chapters.
      Stream.tap(() => Effect.yieldNow),
      Stream.runDrain,
    );

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
          const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src") ?? "";
          const fragment = src.split("#")[1];
          const file = resolve(ncxDir, src);
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

    const toc: TocEntry[] = [];
    for (const entry of contents) {
      const index = anchors.get(entry.target) ?? anchors.get(entry.target.split("#")[0] ?? "");
      const block = index === undefined ? undefined : blocks[index];
      if (index === undefined || block === undefined || entry.title === "") continue;
      // Books often style chapter titles as bold paragraphs; spaces differ around a <br/>.
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

    const images = [...imageIds].map(([path, id]) => ({ id, path, type: types.get(path) ?? "" }));
    const named = opf.querySelector("meta[name='cover']")?.getAttribute("content");
    const coverItem =
      [...items.values()].find((item) => item.properties.split(" ").includes("cover-image")) ??
      items.get(named ?? "");
    const cover =
      coverItem !== undefined && coverItem.type.startsWith("image/")
        ? { id: "cover", path: coverItem.path, type: coverItem.type }
        : images[0] === undefined
          ? null
          : { ...images[0], id: "cover" };

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
    const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0);

    return {
      title: metadata("title")[0],
      author: metadata("creator")[0],
      subject: metadata("subject").join(", ") || undefined,
      series,
      seriesNumber: Number.isFinite(parsedSeriesNumber) ? parsedSeriesNumber : undefined,
      images,
      cover,
      parsed: new ParsedBook({
        version: PARSED_VERSION,
        // An EPUB has no pages; about 1,800 characters fill a printed novel page.
        pageCount: Math.max(1, Math.round(charCount / 1800)),
        charCount,
        blocks,
        toc,
        figuresThrough: 0,
      }),
    };
  });
}
