import { Effect, Schema } from "effect";

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

export const FigureState = Schema.Literals(["none", "pending", "ready"]);
export type FigureState = typeof FigureState.Type;

export class BookMeta extends Schema.Class<BookMeta>("reader-hero/domain/BookMeta")({
  id: Schema.String,
  title: Schema.String,
  author: Schema.optional(Schema.String),
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

export const TextAlign = Schema.Literals(["left", "right", "justify"]);
export type TextAlign = typeof TextAlign.Type;

export const LibraryView = Schema.Literals(["list", "grid"]);
export type LibraryView = typeof LibraryView.Type;

export class ReaderSettings extends Schema.Class<ReaderSettings>(
  "reader-hero/domain/ReaderSettings",
)({
  theme: ReaderTheme,
  font: ReaderFont,
  fontSize: Schema.Int,
  lineHeight: Schema.Number,
  // Settings saved before these fields existed must still decode, or the user loses their theme.
  libraryView: LibraryView.pipe(Schema.withDecodingDefaultKey(Effect.succeed<LibraryView>("list"))),
  textWidth: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(65))),
  textAlign: TextAlign.pipe(Schema.withDecodingDefaultKey(Effect.succeed<TextAlign>("left"))),
}) {}

export const DEFAULT_SETTINGS = new ReaderSettings({
  theme: "rhlight",
  font: "serif",
  fontSize: 18,
  lineHeight: 1.6,
  libraryView: "list",
  textWidth: 65,
  textAlign: "left",
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

export type StoredImage = Pick<ImageRecord, "blob" | "width" | "height"> & {
  readonly id: string;
};

export class ImageRecord extends Schema.Class<ImageRecord>("reader-hero/domain/ImageRecord")({
  blob: Schema.instanceOf(Blob),
  width: Schema.Number,
  height: Schema.Number,
}) {}

export interface OutlineItem {
  readonly title: string;
  readonly page: number;
  readonly depth: number;
}
