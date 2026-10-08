import { Navigate, Route, Routes, useMatch } from "react-router";
import { ServiceWorkerUpdate } from "@/components/ServiceWorkerUpdate";
import { useOpening } from "@/lib/slide-to";
import { LibraryRoute } from "@/routes/library";
import { ReaderRoute } from "@/routes/reader";

export function App() {
  const opening = useOpening();
  const reading = useMatch("/book/:id");
  const bookId = reading?.params.id;
  // While a book opens, the library still shows and the book prepares hidden under it.
  const preparing = opening !== null;

  // Outside the routes: the prepared book is the one that shows, and the library keeps its state under it.
  return (
    <>
      <Routes>
        <Route path="/" element={null} />
        <Route path="/book/:id" element={null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LibraryRoute hidden={reading !== null && !preparing} />
      {bookId !== undefined && <ReaderRoute key={bookId} bookId={bookId} preparing={preparing} />}
      {/* Takes every tap while a book opens; the indicator shows only when it takes a while. */}
      {opening !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {opening.waiting && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-full bg-(--sheet) px-4 py-2 text-base shadow-2xl motion-safe:animate-fade-in md:text-sm"
            >
              <span className="loading loading-sm loading-spinner" />
              Opening
            </p>
          )}
        </div>
      )}
      <ServiceWorkerUpdate />
    </>
  );
}
