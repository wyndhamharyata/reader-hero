import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { forkApp, stopFiber, type Job } from "@/lib/hooks";

const settleMs = 1500;

export function CopyButton({ text }: { readonly text: string }): ReactElement {
  const [label, setLabel] = useState<"Copy" | "Copied" | "Copy failed">("Copy");
  const job = useRef<Job | null>(null);

  useEffect(
    () => () => {
      if (job.current !== null) stopFiber(job.current);
    },
    [],
  );

  const copy = (): void => {
    if (job.current !== null) stopFiber(job.current);
    // A plain-IP page has no clipboard API. tryPromise turns that TypeError into a failure too.
    job.current = forkApp(
      Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
        Effect.match({
          onSuccess: () => "Copied" as const,
          onFailure: () => "Copy failed" as const,
        }),
        Effect.tap((result) => Effect.sync(() => setLabel(result))),
        Effect.andThen(Effect.sleep(`${settleMs} millis`)),
        Effect.andThen(Effect.sync(() => setLabel("Copy"))),
      ),
    );
  };

  return (
    <button type="button" className="row-item" disabled={text === ""} onClick={copy}>
      <span
        className={`row-label ${label === "Copy failed" ? "text-(--red)" : ""}`}
        aria-live="polite"
      >
        {label}
      </span>
    </button>
  );
}
