import type { ReactElement, RefObject } from "react";
import { PlusIcon } from "@/components/icons";
import type { Shelf } from "@/lib/shelf";
import { BookCover } from "./_BookCover";

export function SeriesCoverField({
  cover,
  picture,
  seriesId,
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
  readonly ids: ReadonlyArray<string>;
  readonly cards: Shelf["cards"];
  readonly storedCover: string | undefined;
  readonly onCover: (cover: string | undefined) => void;
  readonly pictureUrl: RefObject<string | null>;
  readonly onPicture: (picture: { readonly file: File; readonly url: string } | null) => void;
}): ReactElement {
  const values: Array<string | undefined> = [
    undefined,
    ...ids,
    ...(picture !== null || storedCover === "image" ? ["image"] : []),
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Cover"
      className="-mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 py-1.5"
    >
      {values.map((value) => {
        const label =
          value === undefined
            ? "Book in progress, or the first"
            : value === "image"
              ? "Own image"
              : (cards.get(value)?.book.title ?? "");

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
            <span className="block rounded-md peer-checked:ring-2 peer-checked:ring-base-content peer-checked:ring-offset-2 peer-checked:ring-offset-(--sheet) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary">
              {value === undefined ? (
                <span className="grid aspect-[2/3] place-items-center rounded-md bg-base-300 text-xs">
                  Auto
                </span>
              ) : value === "image" && picture !== null ? (
                <img
                  src={picture.url}
                  alt=""
                  className="aspect-[2/3] w-full rounded-md bg-white object-cover object-top"
                />
              ) : (
                <BookCover
                  bookId={value === "image" ? `series:${seriesId}` : value}
                  rounded="rounded-md"
                />
              )}
            </span>
          </label>
        );
      })}
      <label
        className="grid aspect-[2/3] w-12 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-base-content/30 has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-primary"
        title="Choose image"
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose image"
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
        <PlusIcon className="size-5 opacity-60" />
      </label>
    </div>
  );
}
