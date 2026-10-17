import { TOUR_VERSION, type BookMeta, type ReadingProgress, type Series } from "@/domain/book";

export interface LibraryValue {
  readonly books: ReadonlyArray<BookMeta>;
  readonly estimate: { readonly usage: number; readonly quota: number } | null;
  readonly reading: ReadonlyMap<string, ReadingProgress | null>;
  readonly series: ReadonlyArray<Series>;
}

const EMPTY_LIBRARY: LibraryValue = {
  books: [],
  estimate: null,
  reading: new Map(),
  series: [],
};

export function loadedLibrary(state: {
  readonly status: string;
  readonly value?: LibraryValue;
}): LibraryValue {
  if (state.status !== "done" || state.value === undefined) return EMPTY_LIBRARY;

  return state.value;
}

export function showsTour({
  hidden,
  status,
  tour,
  steps,
}: {
  readonly hidden: boolean;
  readonly status: string;
  readonly tour: number | undefined;
  readonly steps: ReadonlyArray<unknown>;
}): boolean {
  return !hidden && status !== "loading" && (tour ?? 0) < TOUR_VERSION && steps.length > 0;
}

export function booksToShow(
  hidden: boolean,
  books: ReadonlyArray<BookMeta>,
): ReadonlyArray<BookMeta> {
  return hidden ? [] : books;
}

export function actionLabelFor(busy: boolean): string {
  return busy ? "Working…" : "Add book";
}

export function columnsFor(
  isGrid: boolean,
  wide: { readonly sm: boolean; readonly md: boolean },
): number {
  if (isGrid) return wide.md ? 5 : wide.sm ? 3 : 2;

  return wide.md ? 2 : 1;
}

export function hiddenClass(hidden: boolean): string {
  return hidden ? "invisible" : "";
}
