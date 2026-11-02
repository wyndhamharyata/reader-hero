import type { CSSProperties, ReactElement } from "react";
import { seriesColors } from "@/lib/shelf";

export function SeriesColourField({
  shownColor,
  onColor,
}: {
  readonly shownColor: number | undefined;
  readonly onColor: (hue: number) => void;
}): ReactElement {
  return (
    <fieldset className="flex flex-wrap gap-2.5">
      <legend className="field-label">Colour</legend>
      {seriesColors.map(({ name: label, hue }) => (
        <label key={hue} title={label}>
          <input
            type="radio"
            name="series-colour"
            className="sr-only"
            aria-label={label}
            checked={shownColor === hue}
            onChange={() => onColor(hue)}
          />
          <span className="cloth" style={{ "--hue": hue } as CSSProperties} />
        </label>
      ))}
    </fieldset>
  );
}
