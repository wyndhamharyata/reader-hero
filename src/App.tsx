import { matchPath, Navigate, Route, Routes, useMatch } from "react-router";
import { ServiceWorkerUpdate } from "@/components/ServiceWorkerUpdate";
import { useOpening } from "@/lib/slide-to";
import { LibraryRoute } from "@/routes/library";
import { ReaderRoute } from "@/routes/reader";

export function App() {
  const opening = useOpening();
  const reading = useMatch("/book/:id");
  const bookId =
    reading?.params.id ??
    (opening === null ? undefined : matchPath("/book/:id", opening.to)?.params.id);

  // The reader sits outside the routes, so the book prepared under the library is the one that shows.
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryRoute />} />
        <Route path="/book/:id" element={null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {bookId !== undefined && (
        <ReaderRoute key={bookId} bookId={bookId} preparing={reading === null} />
      )}
      {/* Takes every tap while a book opens; the indicator shows only when it takes a while. */}
      {opening !== null && opening.stage !== "pressed" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {opening.stage === "waiting" && (
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
