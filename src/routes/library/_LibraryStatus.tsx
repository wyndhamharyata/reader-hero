import type { ReactElement } from "react";
import type { BookMeta } from "@/domain/book";

interface Props {
  loading: boolean;
  failed: boolean;
  books: ReadonlyArray<BookMeta>;
}

export function LibraryStatus({ loading, failed, books }: Props): ReactElement {
  const empty = !loading && !failed && books.length === 0;

  return (
    <>
      {loading && <p className="opacity-70">Loading library…</p>}

      {failed && (
        <div className="alert alert-error">
          <span>Your library could not be loaded.</span>
        </div>
      )}

      {empty && (
        <div className="rounded-box bg-base-200 p-8 text-center">
          <p className="text-lg font-medium">No books yet</p>
          <p className="mt-1 text-sm opacity-70">
            Add a PDF or EPUB and read it in a clean, reflowed view.
          </p>
        </div>
      )}
    </>
  );
}
