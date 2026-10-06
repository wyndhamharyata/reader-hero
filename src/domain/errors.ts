import { Schema } from "effect";

export class BookNotFound extends Schema.TaggedError<BookNotFound>()("BookNotFound", {
  id: Schema.String,
}) {}

export class ParsedMissing extends Schema.TaggedError<ParsedMissing>()("ParsedMissing", {
  id: Schema.String,
}) {}

export class StorageFailure extends Schema.TaggedError<StorageFailure>()("StorageFailure", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class PdfFailure extends Schema.TaggedError<PdfFailure>()("PdfFailure", {
  reason: Schema.Literals(["password", "corrupt", "stalled", "unknown"]),
  message: Schema.String,
}) {}

export class EpubFailure extends Schema.TaggedError<EpubFailure>()("EpubFailure", {
  reason: Schema.Literals(["corrupt", "drm", "fixed-layout"]),
}) {}

export class UnsupportedFile extends Schema.TaggedError<UnsupportedFile>()("UnsupportedFile", {
  name: Schema.String,
}) {}

export class ImportFailure extends Schema.TaggedError<ImportFailure>()("ImportFailure", {
  name: Schema.String,
  cause: Schema.Defect(),
}) {}
