import { Schema } from "effect";

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
}) {}

export class BookMeta extends Schema.Class<BookMeta>("reader-hero/domain/BookMeta")({
  id: Schema.String,
  title: Schema.String,
  author: Schema.optional(Schema.String),
  addedAt: Schema.Int,
  fileSize: Schema.Int,
  pageCount: Schema.Int,
  parseState: ParseState,
  charCount: Schema.Int,
}) {}

export class ReadingProgress extends Schema.Class<ReadingProgress>(
  "reader-hero/domain/ReadingProgress",
)({
  blockIndex: Schema.Int,
  percent: Schema.Number,
  updatedAt: Schema.Int,
}) {}

export const ReaderTheme = Schema.Literals(["rhlight", "rhsepia", "rhdark"]);
export type ReaderTheme = typeof ReaderTheme.Type;

export const ReaderFont = Schema.Literals(["serif", "sans"]);
export type ReaderFont = typeof ReaderFont.Type;

export class ReaderSettings extends Schema.Class<ReaderSettings>("reader-hero/domain/ReaderSettings")({
  theme: ReaderTheme,
  font: ReaderFont,
  fontSize: Schema.Int,
  lineHeight: Schema.Number,
}) {}

export const DEFAULT_SETTINGS = new ReaderSettings({
  theme: "rhlight",
  font: "serif",
  fontSize: 18,
  lineHeight: 1.6,
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

export interface StoredImage {
  readonly id: string;
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export class ImageRecord extends Schema.Class<ImageRecord>("reader-hero/domain/ImageRecord")({
  blob: Schema.instanceOf(Blob),
  width: Schema.Int,
  height: Schema.Int,
}) {}

export interface OutlineItem {
  readonly title: string;
  readonly page: number;
  readonly depth: number;
}
