import type { CSSProperties, ReactElement } from "react";

const longestQuery = 24;
const slotCount = 9;
const openSlot = 4;
const cardCount = 5;

const statusNames: Record<string, { readonly alone: string; readonly within: string }> = {
  reading: { alone: "Nothing you're reading", within: "Reading" },
  finished: { alone: "No finished books", within: "Finished" },
};

// Names what the reader asked for, so the cause shows without looking back up at the field.
export function noMatchesText(
  query: string,
  status: string | null,
): { readonly heading: string; readonly action: string } {
  const words = query.trim();
  const shown = words.length > longestQuery ? `${words.slice(0, longestQuery)}…` : words;
  const names = status === null ? undefined : statusNames[status];

  if (words === "") return { heading: names?.alone ?? "No books match", action: "Show all books" };
  if (names === undefined) return { heading: `Nothing for "${shown}"`, action: "Clear search" };

  return { heading: `Nothing for "${shown}" in ${names.within}`, action: "Clear both" };
}

// A card catalogue cabinet: one drawer pulled open, and its cards riffled through for the search.
export function NoMatches({
  query,
  status,
  onClear,
}: {
  readonly query: string;
  readonly status: string | null;
  readonly onClear: () => void;
}): ReactElement {
  const { heading, action } = noMatchesText(query, status);

  return (
    <section className="flex flex-col items-center px-4 pt-6 pb-10 text-center">
      <div className="catalog" aria-hidden="true">
        <div className="floor" />
        <div className="cabinet">
          {Array.from({ length: slotCount }, (_, index) => (
            <span key={index} className={index === openSlot ? "slot hollow" : "slot"} />
          ))}
        </div>
        <div className="slide">
          <div className="tray">
            {Array.from({ length: cardCount }, (_, index) => (
              <span key={index} className="file" style={{ "--i": index } as CSSProperties} />
            ))}
          </div>
          <div className="front">
            <span className="ring" />
          </div>
        </div>
      </div>
      <h2 className="mt-8 font-serif text-xl font-bold break-words">{heading}</h2>
      <button type="button" className="key mt-6" onClick={onClear}>
        {action}
      </button>
    </section>
  );
}
