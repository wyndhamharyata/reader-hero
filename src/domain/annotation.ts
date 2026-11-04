import { Schema } from "effect";

export class AnnotationPoint extends Schema.Class<AnnotationPoint>(
  "reader-hero/domain/AnnotationPoint",
)({
  block: Schema.Int,
  offset: Schema.Int,
}) {}

// A saved highlight. It is the bookmark too: its place, quote and note are all it needs.
export class Annotation extends Schema.Class<Annotation>("reader-hero/domain/Annotation")({
  id: Schema.String,
  bookId: Schema.String,
  from: AnnotationPoint,
  to: AnnotationPoint,
  page: Schema.Int,
  // One entry per text block covered, in order.
  quote: Schema.Array(Schema.String),
  // The text around the range, kept to find it again after a rebuild.
  before: Schema.String,
  after: Schema.String,
  note: Schema.optional(Schema.String),
  // The stored text did not match when it was checked.
  lost: Schema.optional(Schema.Boolean),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}) {}

export const annotationKey = (annotation: {
  readonly bookId: string;
  readonly id: string;
}): string => `${annotation.bookId}/${annotation.id}`;
