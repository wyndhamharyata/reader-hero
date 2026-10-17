import { TOUR_VERSION, type BookMeta, type ReadingProgress, type Series } from "@/domain/book";
import type { AsyncState } from "@/lib/hooks";

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

export function loadedLibrary(state: AsyncState<LibraryValue, unknown>): LibraryValue {
  if (state.status !== "done") return EMPTY_LIBRARY;

  return state.value;
}

export function showsTour({
  isHidden,
  state,
  tour,
  steps,
}: {
  readonly isHidden: boolean;
  readonly state: AsyncState<unknown, unknown>;
  readonly tour: number | undefined;
  readonly steps: ReadonlyArray<unknown>;
}): boolean {
  return !isHidden && state.status !== "loading" && (tour ?? 0) < TOUR_VERSION && steps.length > 0;
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

export function hiddenClass(isHidden: boolean): string {
  return isHidden ? "invisible" : "";
}

export function columnsFor(
  isGrid: boolean,
  wide: { readonly isSm: boolean; readonly isMd: boolean },
): number {
  if (!isGrid) return wide.isMd ? 2 : 1;
  if (wide.isMd) return 5;
  if (wide.isSm) return 3;

  return 2;
}
