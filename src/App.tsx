import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useMatch } from "react-router";
import { ServiceWorkerUpdate } from "@/components/ServiceWorkerUpdate";
import { isInstalled } from "@/lib/platform";
import { LibraryRoute } from "@/routes/library";
import { ReaderRoute } from "@/routes/reader";

export function App() {
  const bookId = useMatch("/book/:id")?.params.id;
  const { pathname } = useLocation();

  // iOS relaunches an installed app at "/", so the launch reopens the screen that was last shown.
  useEffect(() => {
    if (!isInstalled) return;
    try {
      localStorage.setItem("last-screen", pathname);
    } catch {
      // Without storage the launch opens the library.
    }
  }, [pathname]);

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
