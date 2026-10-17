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
  isHidden,
  status,
  tour,
  steps,
}: {
  readonly isHidden: boolean;
  readonly status: string;
  readonly tour: number | undefined;
  readonly steps: ReadonlyArray<unknown>;
}): boolean {
  return !isHidden && status !== "loading" && (tour ?? 0) < TOUR_VERSION && steps.length > 0;
}

export function booksToShow(
  isHidden: boolean,
  books: ReadonlyArray<BookMeta>,
): ReadonlyArray<BookMeta> {
  return isHidden ? [] : books;
}

export function actionLabelFor(isBusy: boolean): string {
  return isBusy ? "Working…" : "Add book";
}

export function columnsFor(
  isGrid: boolean,
  wide: { readonly isSm: boolean; readonly isMd: boolean },
): number {
  if (isGrid) return wide.isMd ? 5 : wide.isSm ? 3 : 2;

  return wide.isMd ? 2 : 1;
}

export function hiddenClass(isHidden: boolean): string {
  return isHidden ? "invisible" : "";
}
