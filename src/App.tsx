import { Navigate, Route, Routes, useMatch } from "react-router";
import { ServiceWorkerUpdate } from "@/components/ServiceWorkerUpdate";
import { LibraryRoute } from "@/routes/library";
import { ReaderRoute } from "@/routes/reader";

export function App() {
  const bookId = useMatch("/book/:id")?.params.id;

  // Outside the routes, so the library keeps its state under an open book.
  return (
    <>
      <Routes>
        <Route path="/" element={null} />
        <Route path="/book/:id" element={null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LibraryRoute hidden={bookId !== undefined} />
      {bookId !== undefined && <ReaderRoute key={bookId} bookId={bookId} />}
      <ServiceWorkerUpdate />
    </>
  );
}
