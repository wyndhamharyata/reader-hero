import { Navigate, Route, Routes } from "react-router";
import { ServiceWorkerUpdate } from "@/components/ServiceWorkerUpdate";
import { LibraryRoute } from "@/routes/library";
import { ReaderRoute } from "@/routes/reader";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryRoute />} />
        <Route path="/book/:id" element={<ReaderRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ServiceWorkerUpdate />
    </>
  );
}
