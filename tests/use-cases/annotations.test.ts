import { describe, expect, it } from "vitest";
import { Annotation, AnnotationPoint } from "@/domain/annotation";
import { Block, PARSED_VERSION, ParsedBook } from "@/domain/book";
import { mergeAnchor } from "@/use-cases/annotations";

const point = (block: number, offset: number): AnnotationPoint =>
  new AnnotationPoint({ block, offset });
const paragraph = (text: string, page: number): Block =>
  new Block({ kind: "paragraph", level: 0, text, page });
const parsed = new ParsedBook({
  version: PARSED_VERSION,
  pageCount: 2,
  charCount: 34,
  blocks: [paragraph("The quick brown fox", 1), paragraph("jumps over the dog", 2)],
  toc: [],
  figuresThrough: 0,
});

const saved = (fields: Partial<Annotation> & Pick<Annotation, "id" | "from" | "to">): Annotation =>
  new Annotation({
    bookId: "b",
    page: 1,
    quote: ["quick"],
    before: "The ",
    after: " brown",
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  });

describe("mergeAnchor", () => {
  it("given a selection over a saved highlight, keeps its id and takes the wider range", () => {
    const stored = [saved({ id: "a", from: point(0, 4), to: point(0, 9), note: "one" })];

    const { annotation, replaced } = mergeAnchor("b", parsed, stored, {
      from: point(0, 0),
      to: point(1, 6),
    });

    expect(annotation.id).toBe("a");
    expect(annotation.from).toEqual(point(0, 0));
    expect(annotation.to).toEqual(point(1, 6));
    expect(annotation.quote).toEqual(["The quick brown fox", "jumps "]);
    expect(annotation.before).toBe("");
    expect(annotation.after).toBe("over the dog");
    expect(annotation.note).toBe("one");
    expect(replaced).toEqual([]);
  });

  it("given a selection over two saved highlights, joins them into one and lists the others", () => {
    const stored = [
      saved({ id: "a", from: point(0, 0), to: point(0, 3), note: "first", createdAt: 1 }),
      saved({ id: "c", from: point(1, 0), to: point(1, 5), note: "second", createdAt: 2 }),
    ];

    const { annotation, replaced } = mergeAnchor("b", parsed, stored, {
      from: point(0, 0),
      to: point(1, 5),
    });

    expect(annotation.id).toBe("a");
    expect(annotation.createdAt).toBe(1);
    expect(annotation.note).toBe("first\n\nsecond");
    expect(replaced).toEqual(["c"]);
  });

  it("given a selection inside one saved highlight, keeps that highlight as it was", () => {
    const stored = [saved({ id: "a", from: point(0, 0), to: point(0, 19) })];

    const { annotation } = mergeAnchor("b", parsed, stored, {
      from: point(0, 4),
      to: point(0, 9),
    });

    expect(annotation.id).toBe("a");
    expect(annotation.from).toEqual(point(0, 0));
    expect(annotation.to).toEqual(point(0, 19));
    expect(annotation.note).toBeUndefined();
  });
});
