import { Effect, Schema, SchemaTransformation } from "effect";
import { BookKind } from "@/domain/ai";

export const ParseState = Schema.Literals(["pending", "parsing", "ready", "scanned", "failed"]);
export type ParseState = typeof ParseState.Type;

export const BlockKind = Schema.Literals(["heading", "paragraph", "image"]);
export type BlockKind = typeof BlockKind.Type;

export class Block extends Schema.Class<Block>("reader-hero/domain/Block")({
  kind: BlockKind,
  level: Schema.Int,
  text: Schema.String,
  page: Schema.Int,
  imageId: Schema.optional(Schema.String),
  // Width over height of a figure, so its placeholder has the final size before the image loads.
  ratio: Schema.optional(Schema.Number),
  // Character ranges of `text`; only EPUB blocks carry them, so a PDF block renders as plain text.
  marks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        start: Schema.Int,
        end: Schema.Int,
        style: Schema.Literals(["bold", "italic"]),
      }),
    ),
  ),
}) {}

export class TocEntry extends Schema.Class<TocEntry>("reader-hero/domain/TocEntry")({
  title: Schema.String,
  page: Schema.Int,
  blockIndex: Schema.Int,
  depth: Schema.Int,
}) {}

export const PARSED_VERSION = 2;

export class ParsedBook extends Schema.Class<ParsedBook>("reader-hero/domain/ParsedBook")({
  version: Schema.Int,
  pageCount: Schema.Int,
  charCount: Schema.Int,
  blocks: Schema.Array(Block),
  toc: Schema.Array(TocEntry),
  // Every page up to here has its figures stored, so an interrupted figure job resumes after it.
  figuresThrough: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
}) {}

// The figure job's finished pages, kept apart from ParsedBook so each page can move it cheaply.
// `through` is the shape an earlier build wrote: every page up to it is finished.
export class FigureCheckpoint extends Schema.Class<FigureCheckpoint>(
  "reader-hero/domain/FigureCheckpoint",
)({
  through: Schema.optional(Schema.Int),
  pages: Schema.optional(Schema.Array(Schema.Int)),
}) {}

// Each page's raw text, kept from the parse until the figure job has used it.
export const StoredPages = Schema.Array(
  Schema.Struct({
    page: Schema.Int,
    width: Schema.Number,
    height: Schema.Number,
    items: Schema.Array(
      Schema.Struct({
        str: Schema.String,
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
        fontSize: Schema.Number,
        fontFamily: Schema.String,
        hasEOL: Schema.Boolean,
      }),
    ),
  }),
);
export type StoredPages = typeof StoredPages.Type;

export const FigureState = Schema.Literals(["none", "pending", "ready"]);
export type FigureState = typeof FigureState.Type;

export class BookMeta extends Schema.Class<BookMeta>("reader-hero/domain/BookMeta")({
  id: Schema.String,
  title: Schema.String,
  author: Schema.optional(Schema.String),
  // Searchable metadata; books imported before these fields existed do not have them.
  subject: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.String),
  fileName: Schema.optional(Schema.String),
  // Older EPUB imports receive these fields when rebuilt.
  series: Schema.optional(Schema.String),
  seriesNumber: Schema.optional(Schema.Number),
  // Books imported before EPUB support have no format and are PDFs.
  format: Schema.optional(Schema.Literals(["pdf", "epub"])),
  addedAt: Schema.Int,
  fileSize: Schema.Int,
  pageCount: Schema.Int,
  parseState: ParseState,
  charCount: Schema.Int,
  figures: Schema.optional(FigureState),
}) {
  get figuresPending(): boolean {
    return this.figures === "pending";
  }
}

export class Series extends Schema.Class<Series>("reader-hero/domain/Series")({
  id: Schema.String,
  name: Schema.String,
  books: Schema.Array(Schema.Struct({ id: Schema.String, number: Schema.optional(Schema.Number) })),
  possible: Schema.Array(
    Schema.Struct({ id: Schema.String, number: Schema.optional(Schema.Number) }),
  ),
  edited: Schema.optional(Schema.Boolean),
  removed: Schema.Array(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
}) {}

export class ReadingProgress extends Schema.Class<ReadingProgress>(
  "reader-hero/domain/ReadingProgress",
)({
  blockIndex: Schema.Int,
  percent: Schema.Number,
  updatedAt: Schema.Int,
  // The furthest block the reader reached; the summary follows it, so re-reading moves nothing.
  furthest: Schema.optional(Schema.Int),
  // Unset means the 98% rule decides.
  finished: Schema.optional(Schema.Boolean),
}) {}

// Sepia gave way to the temperature setting; a stored sepia choice opens as light.
export const ReaderTheme = Schema.Literals(["rhlight", "rhsepia", "rhdark"]).pipe(
  Schema.decodeTo(
    Schema.Literals(["rhlight", "rhdark"]),
    SchemaTransformation.transform({
      decode: (theme) => (theme === "rhsepia" ? "rhlight" : theme),
      encode: (theme) => theme,
    }),
  ),
);
export type ReaderTheme = typeof ReaderTheme.Type;

export const ReaderFont = Schema.Literals(["serif", "sans", "mono"]);
export type ReaderFont = typeof ReaderFont.Type;
export const fontFamily: Record<ReaderFont, string> = {
  serif: "Literata Variable",
  sans: "Atkinson Hyperlegible Next Variable",
  mono: "Atkinson Hyperlegible Mono Variable",
};

export const TextAlign = Schema.Literals(["left", "right", "justify"]);
export type TextAlign = typeof TextAlign.Type;

export const LibraryView = Schema.Literals(["list", "grid"]);
export type LibraryView = typeof LibraryView.Type;

export const LibrarySort = Schema.Literals(["recent", "added", "title"]);
export type LibrarySort = typeof LibrarySort.Type;

export class ReaderSettings extends Schema.Class<ReaderSettings>(
  "reader-hero/domain/ReaderSettings",
)({
  theme: ReaderTheme,
  font: ReaderFont,
  fontSize: Schema.Int,
  lineHeight: Schema.Number,
  // Settings saved before these fields existed must still decode, or the user loses their theme.
  libraryView: LibraryView.pipe(Schema.withDecodingDefaultKey(Effect.succeed<LibraryView>("list"))),
  librarySort: LibrarySort.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<LibrarySort>("added")),
  ),
  textWidth: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(65))),
  textAlign: TextAlign.pipe(Schema.withDecodingDefaultKey(Effect.succeed<TextAlign>("left"))),
  // -1 is the coolest, 0 neutral, 1 the warmest.
  temperature: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
}) {}

export const ReaderMode = Schema.Literals(["reader", "original"]);
export type ReaderMode = typeof ReaderMode.Type;

// One book's own choices; a missing field falls back to the global ReaderSettings.
export class BookPrefs extends Schema.Class<BookPrefs>("reader-hero/domain/BookPrefs")({
  mode: Schema.optional(ReaderMode),
  // Unset means the guess applies.
  kind: Schema.optional(BookKind),
  theme: Schema.optional(ReaderTheme),
  font: Schema.optional(ReaderFont),
  fontSize: Schema.optional(Schema.Int),
  lineHeight: Schema.optional(Schema.Number),
  textAlign: Schema.optional(TextAlign),
  textWidth: Schema.optional(Schema.Int),
  temperature: Schema.optional(Schema.Number),
}) {}

export const DEFAULT_SETTINGS = new ReaderSettings({
  theme: "rhlight",
  font: "serif",
  fontSize: 18,
  lineHeight: 1.6,
  libraryView: "list",
  librarySort: "added",
  textWidth: 65,
  textAlign: "left",
  temperature: 0,
});

export interface RawTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly hasEOL: boolean;
}

export interface PageText {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly items: ReadonlyArray<RawTextItem>;
}

export type PageSize = Omit<PageText, "items">;

export interface ImagePlacement {
  readonly id: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageImage extends ImagePlacement {
  readonly blob: Blob;
}

export type StoredImage = Pick<ImageRecord, "blob" | "width" | "height" | "x" | "y"> & {
  readonly id: string;
};

export class ImageRecord extends Schema.Class<ImageRecord>("reader-hero/domain/ImageRecord")({
  blob: Schema.instanceOf(Blob),
  width: Schema.Number,
  height: Schema.Number,
  // The placement on the page, kept so a resumed figure job can rebuild finished pages; images
  // stored before this field existed do not have it.
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
}) {}

export interface OutlineItem {
  readonly title: string;
  readonly page: number;
  readonly depth: number;
}
