import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { runApp } from "@/lib/hooks";
import { reparseBook } from "@/use-cases/parse-book";

interface Options {
  readonly bookId: string;
  readonly loadError: { readonly _tag: string } | null;
  readonly reload: () => void;
}

// An out-of-date reader view rebuilds on open, once. A failure keeps the button.
export function useReaderRepair({ bookId, loadError, reload }: Options): {
  readonly isRepairing: boolean;
  readonly message: string | null;
  readonly rebuild: () => void;
} {
  const [repair, setRepair] = useState<"idle" | "running" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const rebuiltOnce = useRef(false);

  const rebuild = () => {
    setRepair("running");
    setMessage(null);

    const report = (text: string) => {
      setMessage(text);
      setRepair("failed");
    };
    const program = reparseBook(bookId, () => {}, report).pipe(
      Effect.tap(() => Effect.sync(() => reload())),
    );

    void runApp(program);
  };

  useEffect(() => {
    if (loadError?._tag !== "ParsedMissing" || rebuiltOnce.current) return;

    rebuiltOnce.current = true;
    rebuild();
  });

  // The repair screen waits for the rebuild and for the reload that follows it.
  useEffect(() => {
    if (repair !== "running") return;
    if (loadError === null || loadError._tag !== "ParsedMissing") setRepair("idle");
  }, [repair, loadError]);

  const isParsedMissing = loadError?._tag === "ParsedMissing";
  const isRepairing = repair === "running" || (isParsedMissing && !rebuiltOnce.current);

  return { isRepairing, message, rebuild };
}
