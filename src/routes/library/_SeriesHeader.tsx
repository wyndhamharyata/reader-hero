import type { CSSProperties, ReactElement, RefObject } from "react";
import { BookCover } from "@/components/BookCover";
import type { Shelf } from "@/lib/shelf";
import { SeriesColourField } from "./_SeriesColourField";
import { SeriesCoverField } from "./_SeriesCoverField";

export function SeriesHeader({
  cover,
  picture,
  front,
  seriesId,
  name,
  onName,
  bookCount,
  shownColor,
  onColor,
  ids,
  cards,
  storedCover,
  onCover,
  pictureUrl,
  onPicture,
}: {
  readonly cover: string | null | undefined;
  readonly picture: { readonly file: File; readonly url: string } | null;
  readonly front: string | undefined;
  readonly seriesId: string | null;
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly bookCount: number;
  readonly shownColor: number | undefined;
  readonly onColor: (hue: number) => void;
  readonly ids: ReadonlyArray<string>;
  readonly cards: Shelf["cards"];
  readonly storedCover: string | undefined;
  readonly onCover: (cover: string | undefined) => void;
  readonly pictureUrl: RefObject<string | null>;
  readonly onPicture: (picture: { readonly file: File; readonly url: string } | null) => void;
}): ReactElement {
  const frontBook = front === undefined ? undefined : cards.get(front)?.book;
  const slipcaseStyle = { "--hue": shownColor ?? 159 } as CSSProperties;

  return (
    <>
      <div className="flex items-center gap-5.5 pt-2 pb-1.5">
        <span className="slipcase w-19 shrink-0" style={slipcaseStyle}>
          <span className="book">
            {cover === "image" && picture !== null ? (
              <span className="cover">
                <img src={picture.url} alt="" />
              </span>
            ) : cover === "image" ? (
              <BookCover book={{ id: `series:${seriesId}`, title: name, format: "epub" }} />
            ) : frontBook !== undefined ? (
              <BookCover book={frontBook} />
            ) : (
              <span className="cover blank" />
            )}
            <span className="index-tab">{bookCount}</span>
          </span>
        </span>
        <label className="min-w-0 flex-1">
          <span className="field-label mt-0">Name</span>
          <span className="field">
            <input
              type="text"
              className="font-semibold"
              placeholder="Name"
              value={name}
              onChange={(event) => onName(event.target.value)}
            />
          </span>
        </label>
      </div>
      <SeriesColourField shownColor={shownColor} onColor={onColor} />
      <SeriesCoverField
        cover={cover}
        picture={picture}
        seriesId={seriesId}
        name={name}
        ids={ids}
        cards={cards}
        storedCover={storedCover}
        onCover={onCover}
        pictureUrl={pictureUrl}
        onPicture={onPicture}
      />
    </>
  );
}
