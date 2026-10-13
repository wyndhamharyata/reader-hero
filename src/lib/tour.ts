export interface TourStep {
  readonly anchor: string | null;
  readonly title: string;
  readonly body: string;
}

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

// The card keeps clear of the spotlight: under it when the target is high, over it when the target is low.
export function dockAt(spot: Box | null, viewportHeight: number): "top" | "bottom" | "center" {
  if (spot === null) return "center";
  return spot.top + spot.height / 2 < viewportHeight / 2 ? "bottom" : "top";
}

export function tourSteps(options: {
  readonly books: boolean;
  readonly install: boolean;
}): ReadonlyArray<TourStep> {
  return [
    {
      anchor: null,
      title: "Welcome to Reader Hero",
      body: "It turns a PDF or an EPUB into a book that reads well on a phone. Everything stays on this device, and the reader works with no network.",
    },
    {
      anchor: "import",
      title: "Add your books",
      body: "Tap here and pick a PDF or an EPUB. You can pick several at once.",
    },
    ...(options.install
      ? [
          {
            anchor: "install",
            title: "Keep it offline",
            body: "In Safari, tap Share, then Add to Home Screen. iOS then keeps your library and the reader working with no network.",
          },
        ]
      : []),
    ...(options.books
      ? [
          {
            anchor: "book",
            title: "Open a book",
            body: "Tap a book to open it. Reader Hero remembers your place in every book, and reading works with no network.",
          },
        ]
      : []),
    {
      anchor: null,
      title: "Read on",
      body: "While you read, tap the text to hide the bars. The Menu holds the contents, your summaries, the character list and the text size.",
    },
  ];
}
