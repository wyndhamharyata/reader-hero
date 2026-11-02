import type { BookMeta, ReadingProgress, Series } from "@/domain/book";
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

export function booksToShow(
  isHidden: boolean,
  books: ReadonlyArray<BookMeta>,
): ReadonlyArray<BookMeta> {
  return isHidden ? [] : books;
}

export function hiddenClass(isHidden: boolean): string {
  return isHidden ? "invisible" : "";
}
