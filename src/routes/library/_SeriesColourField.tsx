import type { ReactElement } from "react";
import { CheckIcon } from "@/components/icons";
import { seriesColors } from "@/lib/shelf";

export function SeriesColourField({
  shownColor,
  onColor,
}: {
  readonly shownColor: number | undefined;
  readonly onColor: (hue: number) => void;
}): ReactElement {
  return (
    <fieldset className="grid grid-cols-3 justify-items-center gap-1 md:flex md:flex-wrap">
      <legend className="sr-only">Colour</legend>
      {seriesColors.map(({ name: label, hue }) => (
        <label
          key={hue}
          className="grid size-11 cursor-pointer place-items-center md:size-8"
          title={label}
        >
          <input
            type="radio"
            name="series-colour"
            className="peer sr-only"
            aria-label={label}
            checked={shownColor === hue}
            onChange={() => onColor(hue)}
          />
          <span
            className="grid size-8 place-items-center rounded-full border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary md:size-6"
            style={{
              borderColor: `oklch(var(--tray) ${hue})`,
              backgroundColor: `color-mix(in oklab, oklch(var(--tray) ${hue}) 40%, var(--color-base-100))`,
            }}
          >
            {shownColor === hue && <CheckIcon className="size-5 md:size-4" />}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
