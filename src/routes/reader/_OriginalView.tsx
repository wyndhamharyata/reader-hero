import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { StorageFailure } from "@/domain/errors";
import { runApp } from "@/lib/hooks";
import { BookStore } from "@/services/book-store";
import { PdfClient, type PdfHandle } from "@/services/pdf-client";

interface Props {
  bookId: string;
  pageCount: number;
  initialPage: number;
  onPageChange: (page: number) => void;
}

const RENDER_SCALE = 1;

export function OriginalView({ bookId, pageCount, initialPage, onPageChange }: Props) {
  const [handle, setHandle] = useState<PdfHandle | null>(null);
  const [page, setPage] = useState(initialPage);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PdfHandle | null>(null);

  useEffect(() => {
    let active = true;
    const program = Effect.gen(function* () {
      const store = yield* BookStore;
      const pdf = yield* PdfClient;
      const blob = yield* store.getFile(bookId);
      const data = yield* Effect.tryPromise({
        try: () => blob.arrayBuffer(),
        catch: (cause) => new StorageFailure({ operation: "readFile", cause }),
      });
      return yield* pdf.load(data);
    });

    void runApp(program).then((loaded) => {
      if (!active) return;
      handleRef.current = loaded;
      setHandle(loaded);
    });

    return () => {
      active = false;
    };
  }, [bookId]);

  useEffect(() => {
    return () => {
      const current = handleRef.current;
      if (current === null) return;
      void runApp(Effect.flatMap(PdfClient, (pdf) => pdf.release(current)));
    };
  }, []);

  useEffect(() => {
    if (handle === null) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    void runApp(Effect.flatMap(PdfClient, (pdf) => pdf.render(handle, page, canvas, RENDER_SCALE)));
  }, [handle, page]);

  const go = (next: number) => {
    const clamped = Math.min(pageCount, Math.max(1, next));
    setPage(clamped);
    onPageChange(clamped);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-start justify-center overflow-auto bg-base-300 p-2">
        <canvas ref={canvasRef} className="max-w-full rounded-box bg-white shadow" />
      </div>
      <div className="flex items-center justify-center gap-3 p-3">
        <button type="button" className="btn btn-sm" onClick={() => go(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span className="text-sm opacity-70">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </div>
  );
}
