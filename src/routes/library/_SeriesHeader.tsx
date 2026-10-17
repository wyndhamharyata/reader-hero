import type { ReactElement, RefObject } from "react";
import type { Shelf } from "@/lib/shelf";
import { BookCover } from "./_BookCover";
import { SeriesColourField } from "./_SeriesColourField";
import { SeriesCoverField } from "./_SeriesCoverField";

export function SeriesHeader({
  cover,
  picture,
  front,
  seriesId,
  name,
  onName,
  author,
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
  readonly author: string | undefined;
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
  return (
    <>
      <div className="flex gap-4 md:gap-5">
        <div className="w-32 shrink-0 md:w-36">
          <span className="relative block w-full overflow-hidden rounded-md shadow-lg ring-1 ring-black/10">
            {cover === "image" && picture !== null ? (
              <img
                src={picture.url}
                alt=""
                className="aspect-[2/3] w-full rounded-md bg-white object-cover object-top"
              />
            ) : front !== undefined ? (
              <BookCover bookId={front} rounded="rounded-md" />
            ) : (
              <span className="grid aspect-[2/3] w-full place-items-center rounded-md bg-base-300 text-xs">
                Auto
              </span>
            )}
            {/* A shade down the left edge reads as the spine of a printed book. */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-2.5 bg-linear-to-r from-black/25 to-transparent" />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs font-medium tracking-wide uppercase opacity-60">Series</p>
          <input
            type="text"
            className="input h-auto w-full shrink-0 px-3 py-1.5 text-lg font-semibold md:text-xl"
            data-font="serif"
            placeholder="Name"
            aria-label="Name"
            value={name}
            onChange={(event) => onName(event.target.value)}
          />
          {author !== undefined && <p className="text-base opacity-70 md:text-sm">{author}</p>}
          <p className="text-sm opacity-60 md:text-xs">
            {bookCount} {bookCount === 1 ? "book" : "books"}
          </p>
          <p
            aria-hidden="true"
            className="mt-1 text-xs font-medium tracking-wide uppercase opacity-60"
          >
            Colour
          </p>
          <SeriesColourField shownColor={shownColor} onColor={onColor} />
        </div>
      </div>
      <p aria-hidden="true" className="text-xs font-medium tracking-wide uppercase opacity-60">
        Cover
      </p>
      <SeriesCoverField
        cover={cover}
        picture={picture}
        seriesId={seriesId}
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
