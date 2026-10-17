import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import type { Summary } from "@/domain/ai";
import { holdLowestRow } from "@/lib/hold-lowest-row";
import type { Chapter } from "@/use-cases/ai-context";
import type { SummaryRun } from "@/use-cases/summary";

export function ChapterList({
  visibleChapters,
  run,
  list,
  current,
  isDesktop,
  expanded,
  setExpanded,
  openAt,
  opened,
  latest,
  body,
  summary,
  unit,
  action,
  pending,
  askError,
  spinner,
}: {
  readonly visibleChapters: ReadonlyArray<{ readonly heading: string; readonly paragraph: string }>;
  readonly run: SummaryRun | null;
  readonly list: ReadonlyArray<Chapter>;
  readonly current: { readonly heading: string; readonly text: string } | null;
  readonly isDesktop: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly setExpanded: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly openAt: number | null;
  readonly opened: RefObject<HTMLDivElement | null>;
  readonly latest: RefObject<HTMLDivElement | null>;
  readonly body: RefObject<HTMLDivElement | null>;
  readonly summary: Summary | null;
  readonly unit: string;
  readonly action: string | null;
  readonly pending: string | null;
  readonly askError: string | null;
  readonly spinner: ReactElement;
}): ReactElement {
  // The chapter in writing shares its stored key, so it stays open once it is stored.
  const entries = [
    ...visibleChapters.map((chapter, index) => ({
      key: `${index}`,
      heading: chapter.heading,
      text: chapter.paragraph,
    })),
    ...(run !== null && run.stage === "chapter" && run.chapter > 0
      ? [
          {
            key: `${run.chapter - 1}`,
            heading: list[run.chapter - 1]?.heading ?? "",
            text: run.text,
          },
        ]
      : []),
    ...(current === null
      ? []
      : [
          {
            key: "current",
            heading: `${current.heading} · current position`,
            text: current.text,
          },
        ]),
  ];

  return (
    <>
      {entries.map((entry, index, all) => {
        const isOpen = isDesktop || expanded.has(entry.key);

        return (
          <div
            key={entry.key}
            ref={entry.key === `${openAt}` ? opened : index === all.length - 1 ? latest : undefined}
            className="px-2"
          >
            {isDesktop ? (
              <p className="px-2 py-2 font-medium">{entry.heading}</p>
            ) : (
              <button
                type="button"
                className="w-full rounded-field px-2 py-2 text-left font-medium hover:bg-base-300"
                data-row
                aria-expanded={isOpen}
                onClick={(event) => {
                  if (body.current !== null) holdLowestRow(body.current, event.currentTarget);

                  setExpanded((keys) => {
                    const next = new Set(keys);

                    if (isOpen) next.delete(entry.key);
                    else next.add(entry.key);

                    return next;
                  });
                }}
              >
                {entry.heading}
              </button>
            )}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
              inert={!isOpen}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="px-2 pb-2 whitespace-pre-wrap">{entry.text}</p>
              </div>
            </div>
          </div>
        );
      })}
      {summary === null && run === null && (
        <p className="px-4 opacity-70">
          {action === null ? `No ${unit}s before this position` : "No summaries"}
        </p>
      )}
      {(summary?.thread ?? []).map((message, index) => (
        <p
          key={index}
          className={`mt-3 px-4 whitespace-pre-wrap ${message.role === "user" ? "font-medium" : ""}`}
        >
          {message.content}
        </p>
      ))}
      {pending !== null && (
        <p className="mt-3 px-4 whitespace-pre-wrap">
          {pending === "" ? (
            <span className="flex items-center gap-2 opacity-70">
              {spinner}
              Waiting for an answer
            </span>
          ) : (
            pending
          )}
        </p>
      )}
      {askError !== null && <p className="mt-2 px-4 text-error">{askError}</p>}
    </>
  );
}
