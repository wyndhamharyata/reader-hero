import { Effect } from "effect";
import { Annotation, AnnotationPoint } from "@/domain/annotation";
import type { ParsedBook } from "@/domain/book";
import type { StorageFailure } from "@/domain/errors";
import { AnnotationStore } from "@/services/annotation-store";

export interface Anchor {
  readonly from: AnnotationPoint;
  readonly to: AnnotationPoint;
}

const isBefore = (a: AnnotationPoint, b: AnnotationPoint): boolean =>
  a.block < b.block || (a.block === b.block && a.offset < b.offset);

const textAt = (parsed: ParsedBook, index: number): string => parsed.blocks[index]?.text ?? "";

// One entry per text block covered, cut at the selection's ends.
function quoteOf(
  parsed: ParsedBook,
  from: AnnotationPoint,
  to: AnnotationPoint,
): ReadonlyArray<string> {
  const quote: Array<string> = [];

  for (let index = from.block; index <= to.block; index += 1) {
    const block = parsed.blocks[index];

    if (block === undefined || block.kind === "image") continue;

    const start = index === from.block ? from.offset : 0;
    const end = index === to.block ? to.offset : block.text.length;
    const slice = block.text.slice(start, end);

    if (slice !== "") quote.push(slice);
  }

  return quote;
}

const overlaps = (
  a: { readonly from: AnnotationPoint; readonly to: AnnotationPoint },
  b: { readonly from: AnnotationPoint; readonly to: AnnotationPoint },
): boolean => !isBefore(a.to, b.from) && !isBefore(b.to, a.from);

// A selection over saved highlights joins them into one, so two highlights never paint as one band.
export function mergeAnchor(
  bookId: string,
  parsed: ParsedBook,
  stored: ReadonlyArray<Annotation>,
  anchor: Anchor,
): { readonly annotation: Annotation; readonly replaced: ReadonlyArray<string> } {
  const touching = stored.filter((entry) => overlaps(entry, anchor));
  const now = Date.now();
  const from = touching.reduce(
    (first, entry) => (isBefore(entry.from, first) ? entry.from : first),
    anchor.from,
  );
  const to = touching.reduce(
    (last, entry) => (isBefore(last, entry.to) ? entry.to : last),
    anchor.to,
  );
  const first = touching[0];
  const notes = touching.flatMap((entry) =>
    entry.note === undefined || entry.note.trim() === "" ? [] : [entry.note.trim()],
  );
  const annotation = new Annotation({
    id: first?.id ?? crypto.randomUUID(),
    bookId,
    from,
    to,
    page: parsed.blocks[from.block]?.page ?? 1,
    quote: quoteOf(parsed, from, to),
    before: textAt(parsed, from.block).slice(Math.max(0, from.offset - 32), from.offset),
    after: textAt(parsed, to.block).slice(to.offset, to.offset + 32),
    ...(notes.length === 0 ? {} : { note: notes.join("\n\n") }),
    createdAt: first?.createdAt ?? now,
    updatedAt: now,
  });

  return {
    annotation,
    replaced: touching.flatMap((entry) => (entry.id === annotation.id ? [] : [entry.id])),
  };
}

export function saveAnnotation(
  annotation: Annotation,
  replaced: ReadonlyArray<string>,
): Effect.Effect<void, StorageFailure, AnnotationStore> {
  return Effect.gen(function* () {
    const store = yield* AnnotationStore;

    yield* store.put(annotation);

    for (const id of replaced) yield* store.remove(annotation.bookId, id);
  });
}

export function saveNote(
  annotation: Annotation,
  note: string,
): Effect.Effect<Annotation, StorageFailure, AnnotationStore> {
  return Effect.gen(function* () {
    const store = yield* AnnotationStore;
    const trimmed = note.trim();
    // An emptied note stores no field rather than an empty string.
    const next = new Annotation({
      id: annotation.id,
      bookId: annotation.bookId,
      from: annotation.from,
      to: annotation.to,
      page: annotation.page,
      quote: annotation.quote,
      before: annotation.before,
      after: annotation.after,
      ...(trimmed === "" ? {} : { note: trimmed }),
      ...(annotation.lost === true ? { lost: true } : {}),
      createdAt: annotation.createdAt,
      updatedAt: Date.now(),
    });

    yield* store.put(next);

    return next;
  });
}

export function removeAnnotation(
  annotation: Annotation,
): Effect.Effect<void, StorageFailure, AnnotationStore> {
  return Effect.flatMap(AnnotationStore, (store) => store.remove(annotation.bookId, annotation.id));
}

export const containsPoint = (annotation: Annotation, point: AnnotationPoint): boolean =>
  !isBefore(point, annotation.from) && !isBefore(annotation.to, point);
