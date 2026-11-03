import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { runApp } from "@/lib/hooks";
import { answerOpenedFile, useIsOpenedFile } from "@/lib/opened-files";
import { slideTo } from "@/lib/slide-to";
import { removeBook } from "@/use-cases/remove-book";

// A launched file asks before the way back to the shelf takes it along.
export function useKeepFile(
  bookId: string,
  cancelSave: () => void,
): {
  readonly isAsking: boolean;
  readonly back: () => void;
  readonly answer: (isKeeping: boolean) => void;
} {
  const navigate = useNavigate();
  const isOpenedFile = useIsOpenedFile(bookId);
  const [isAsking, setAsking] = useState(false);
  // One tap answers, so a fast second tap does nothing.
  const isAnswered = useRef(false);

  // A back gesture skips the alert, so it counts as keeping the book.
  useEffect(() => {
    if (!isOpenedFile) return;

    const keep = (): void => answerOpenedFile(bookId);

    window.addEventListener("popstate", keep);

    return () => window.removeEventListener("popstate", keep);
  }, [isOpenedFile, bookId]);

  const back = (): void => {
    if (isOpenedFile) {
      isAnswered.current = false;
      setAsking(true);
      return;
    }

    slideTo(navigate, "/", "out");
  };

  const answer = (isKeeping: boolean): void => {
    if (isAnswered.current) return;

    isAnswered.current = true;
    setAsking(false);
    answerOpenedFile(bookId);

    if (isKeeping) {
      slideTo(navigate, "/", "out");
      return;
    }

    // A save for a book being removed would write a progress record that outlives it.
    cancelSave();

    // Removed before the shelf shows, so it is not seen going.
    void runApp(
      removeBook(bookId).pipe(
        Effect.catchTag("StorageFailure", () => Effect.void),
        Effect.tap(() => Effect.sync(() => slideTo(navigate, "/", "out"))),
      ),
    );
  };

  return { isAsking, back, answer };
}
