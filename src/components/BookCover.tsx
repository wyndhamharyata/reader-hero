import type { CSSProperties, ReactElement } from "react";
import type { BookMeta } from "@/domain/book";
import { useBookImage } from "@/lib/hooks";

// The same book always gets the same cloth, so a cover without a picture keeps its colour.
export function hueOf(id: string): number {
  let hash = 0;

  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360;

  return hash;
}

// The book's picture over a cloth cover with its title. The cloth shows while the picture loads, and when there is none.
export function BookCover({
  book,
  imageId = "cover",
}: {
  readonly book: Pick<BookMeta, "id" | "title" | "author" | "format">;
  // A series' own picture is stored under the series, not a book.
  readonly imageId?: string;
}): ReactElement {
  const { url } = useBookImage(book.id, imageId);
  const hue = hueOf(book.id);
  const cloth = {
    "--c1": `oklch(52% 0.09 ${hue})`,
    "--c2": `oklch(34% 0.07 ${hue + 12})`,
  } as CSSProperties;
  // A PDF's cover is its first page, which is paper, not a printed jacket.
  const coverClass = book.format === "epub" ? "cover" : "cover paper";

  return (
    <span className={coverClass} style={cloth}>
      <span className="art">
        <span className="title">{book.title}</span>
        {book.author !== undefined && <span className="author">{book.author}</span>}
      </span>
      {url !== null && <img src={url} alt="" draggable={false} />}
    </span>
  );
}
