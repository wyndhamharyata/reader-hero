import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { CheckIcon, ClipboardIcon, ExclamationCircleIcon } from "@/components/icons";
import { forkApp, stopFiber, type Job } from "@/lib/hooks";

interface Props {
  text: string;
}

export function CopyButton({ text }: Props): ReactElement {
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
    // A plain-IP page has no clipboard API, and tryPromise turns that TypeError into a failure too.
    job.current = forkApp(
      Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
        Effect.match({
          onSuccess: () => "Copied" as const,
          onFailure: () => "Copy failed" as const,
        }),
        Effect.tap((result) => Effect.sync(() => setLabel(result))),
        Effect.andThen(Effect.sleep("1500 millis")),
        Effect.andThen(Effect.sync(() => setLabel("Copy"))),
      ),
    );
  };

  const Icon = { Copy: ClipboardIcon, Copied: CheckIcon, "Copy failed": ExclamationCircleIcon }[
    label
  ];

  return (
    <button
      type="button"
      className="btn btn-square btn-ghost md:btn-sm"
      aria-label={label}
      title={label}
      disabled={text === ""}
      onClick={copy}
    >
      <Icon className={`size-6 md:size-4 ${label === "Copy failed" ? "text-error" : ""}`} />
      <span aria-live="polite" className="sr-only">
        {label === "Copy" ? "" : label}
      </span>
    </button>
  );
}
