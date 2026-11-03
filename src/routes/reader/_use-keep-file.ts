import { Effect } from "effect";
import { useState } from "react";
import { useNavigate } from "react-router";
import { runApp } from "@/lib/hooks";
import { answerOpenedFile, useIsOpenedFile } from "@/lib/opened-files";
import { slideTo } from "@/lib/slide-to";
import { removeBook } from "@/use-cases/remove-book";

// A launched file asks before the way back to the shelf takes it along.
export function useKeepFile(bookId: string): {
  readonly isAsking: boolean;
  readonly back: () => void;
  readonly answer: (isKeeping: boolean) => void;
} {
  const navigate = useNavigate();
  const isOpenedFile = useIsOpenedFile(bookId);
  const [isAsking, setAsking] = useState(false);

  const back = (): void => {
    if (isOpenedFile) {
      setAsking(true);
      return;
    }

    slideTo(navigate, "/", "out");
  };

  const answer = (isKeeping: boolean): void => {
    setAsking(false);
    answerOpenedFile(bookId);

    if (isKeeping) {
      slideTo(navigate, "/", "out");
      return;
    }

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
