import type { ReactElement, RefObject } from "react";
import { BookCover } from "@/components/BookCover";
import { PlusIcon } from "@/components/icons";
import type { Shelf } from "@/lib/shelf";

export function SeriesCoverField({
  cover,
  picture,
  seriesId,
  name,
  ids,
  cards,
  storedCover,
  onCover,
  pictureUrl,
  onPicture,
}: {
  readonly cover: string | null | undefined;
  readonly picture: { readonly file: File; readonly url: string } | null;
  readonly seriesId: string | null;
  readonly name: string;
  readonly ids: ReadonlyArray<string>;
  readonly cards: Shelf["cards"];
  readonly storedCover: string | undefined;
  readonly onCover: (cover: string | undefined) => void;
  readonly pictureUrl: RefObject<string | null>;
  readonly onPicture: (picture: { readonly file: File; readonly url: string } | null) => void;
}): ReactElement {
  const values: Array<string | undefined> = [undefined, ...ids];

  if (picture !== null || storedCover === "image") values.push("image");

  return (
    // min-w-0: a fieldset is as wide as its widest row by default, which the panel then scrolls sideways.
    <fieldset className="min-w-0">
      <legend className="field-label">Cover</legend>
      <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pt-1 pb-3 md:-mx-6 md:px-6">
        {values.map((value) => {
          const card = value === undefined || value === "image" ? undefined : cards.get(value);
          const label =
            value === undefined
              ? "The book in progress"
              : value === "image"
                ? "Own picture"
                : (card?.book.title ?? "");

          return (
            <label key={value ?? ""} className="w-12 shrink-0 cursor-pointer" title={label}>
              <input
                type="radio"
                name="series-cover"
                className="peer sr-only"
                aria-label={label}
                checked={cover === value}
                onChange={() => onCover(value)}
              />
              <span className="block rounded-md peer-checked:ring-2 peer-checked:ring-(--ink) peer-checked:ring-offset-2 peer-checked:ring-offset-(--surface) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-(--green)">
                {value === undefined && (
                  <span className="cover blank grid place-items-center text-xs font-semibold text-(--ink-soft)">
                    Auto
                  </span>
                )}
                {value === "image" && picture !== null && (
                  <span className="cover">
                    <img src={picture.url} alt="" />
                  </span>
                )}
                {value === "image" && picture === null && (
                  <BookCover book={{ id: `series:${seriesId}`, title: name, format: "epub" }} />
                )}
                {card !== undefined && <BookCover book={card.book} />}
              </span>
            </label>
          );
        })}
        <label
          className="grid aspect-[2/3] w-12 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-(--ink-soft) has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-(--green)"
          title="Choose picture"
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Choose picture"
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = "";
              if (file === undefined) return;
              if (pictureUrl.current !== null) URL.revokeObjectURL(pictureUrl.current);
              pictureUrl.current = URL.createObjectURL(file);
              onPicture({ file, url: pictureUrl.current });
              onCover("image");
            }}
          />
          <PlusIcon className="icon text-(--ink-soft)" />
        </label>
      </div>
    </fieldset>
  );
}
