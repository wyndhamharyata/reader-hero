import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { AiSettings } from "@/domain/ai";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, stopFiber, type Job, type SummaryState } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import type { Chapter } from "@/use-cases/ai-context";
import {
  describeSummary,
  summaryFollowUp,
  type Coverage,
  type SummaryInput,
} from "@/use-cases/summary";
import { ConsentNote } from "./_ConsentNote";

interface Props {
  input: SummaryInput;
  list: ReadonlyArray<Chapter>;
  cover: Coverage;
  settings: AiSettings;
  state: SummaryState;
  // The chapter to open at, from a line in Contents; null opens at the latest entry.
  openAt: number | null;
  onStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onAddName: (name: string) => void;
  onConsent: () => void;
  onClose: () => void;
}

// The book's whole summary as one document: the chapters before the position, the chapter being
// read up to it, then the characters. The one action, in the foot, brings it up to the position;
// the entry in flight streams in place. Closing the sheet does not stop the job.
export function SummarySheet({
  input,
  list,
  cover,
  settings,
  state,
  openAt,
  onStart,
  onStop,
  onDiscard,
  onAddName,
  onConsent,
  onClose,
}: Props): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [consentPending, setConsentPending] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const opened = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);
  const { summary, run, error } = state;
  const story = input.kind === "story";
  const { row, action } = describeSummary(summary, cover, run, input.kind);
  // A story shows no name whose first chapter is after the position.
  const names = (summary?.names ?? []).filter((entry) => !story || entry.chapter <= cover.target);
  const unit = story ? "chapter" : "section";
  const namesLabel = story ? "Characters" : "Terms";
  const chapterCount = summary?.chapters.length ?? 0;
  const spinner = <span className="loading loading-xs loading-spinner" />;

  // Opens at the chapter tapped in Contents, or at the latest entry; an entry in flight comes into view.
  useEffect(() => {
    const target = openAt !== null && opened.current !== null ? opened.current : latest.current;
    target?.scrollIntoView({ block: "start" });
  }, [openAt, run?.stage, run?.chapter]);

  useEffect(
    () => () => {
      if (job.current !== null) stopFiber(job.current);
    },
    [],
  );

  const start = (): void => {
    if (settings.consentedAt === undefined) {
      setConsentPending(true);
      return;
    }
    onStart();
  };

  const ask = (): void => {
    const asked = question.trim();
    if (summary === null || asked === "" || run !== null || pending !== null) return;
    setQuestion("");
    setPending("");
    setAskError(null);
    job.current = forkApp(
      summaryFollowUp(input, settings, summary, asked, setPending).pipe(
        Effect.match({
          onSuccess: () => setPending(null),
          onFailure: (failure) => {
            setPending(null);
            setAskError(describeAiFailure(failure));
          },
        }),
      ),
    );
  };

  const copy = (): void => {
    if (summary === null) return;
    const text = [
      ...summary.chapters.map((chapter) => `${chapter.heading}\n${chapter.paragraph}`),
      ...(summary.current === undefined
        ? []
        : [`${summary.current.heading} · to here\n${summary.current.text}`]),
      `${namesLabel}\n${names.map((entry) => `${entry.name}: ${entry.note}`).join("\n")}`,
    ].join("\n\n");
    void navigator.clipboard.writeText(text);
  };

  const close = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  // The entry for the chapter being read: the one in flight, else the stored one.
  const current =
    run !== null && run.stage === "current"
      ? { heading: list[run.chapter - 1]?.heading ?? "", text: run.text, live: true }
      : summary?.current === undefined
        ? null
        : { heading: summary.current.heading, text: summary.current.text, live: false };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-black/40 motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={close}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Summary"
        className="relative z-10 mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-box bg-base-100 p-4 pb-[calc(var(--safe-bottom)+0.5rem)] motion-safe:animate-sheet-up md:max-h-[85vh] md:rounded-box md:pb-4"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Summary · {row}</p>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {(summary?.chapters ?? []).map((chapter, index) => (
            <div
              key={index}
              ref={
                index === openAt
                  ? opened
                  : current === null && index === chapterCount - 1
                    ? latest
                    : undefined
              }
              className="mt-3 scroll-mt-2 first:mt-0"
            >
              <p className="text-sm font-medium">{chapter.heading}</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{chapter.paragraph}</p>
            </div>
          ))}
          {run !== null && run.stage === "chapter" && run.chapter > 0 && (
            <div ref={latest} className="mt-3 scroll-mt-2 first:mt-0">
              <p className="text-sm font-medium">{list[run.chapter - 1]?.heading ?? ""}</p>
              {run.text === "" ? (
                <p className="flex items-center gap-2 text-sm opacity-70">
                  {spinner}
                  Waiting for the provider…
                </p>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{run.text}</p>
              )}
            </div>
          )}
          {run !== null && run.stage === "names" && (
            <p className="mt-3 flex items-center gap-2 text-sm opacity-70">
              {spinner}
              {namesLabel}…
            </p>
          )}
          {current !== null && (
            <div ref={latest} className="mt-3 scroll-mt-2 first:mt-0">
              <p className="text-sm font-medium">{current.heading} · to here</p>
              {current.live && current.text === "" ? (
                <p className="flex items-center gap-2 text-sm opacity-70">
                  {spinner}
                  Waiting for the provider…
                </p>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{current.text}</p>
              )}
            </div>
          )}
          {summary === null && run === null && (
            <p className="text-sm opacity-70">
              {action === null ? `No ${unit}s before this position.` : "Nothing summarised yet."}
            </p>
          )}

          {summary !== null && (
            <>
              <p className="mt-4 text-xs font-medium tracking-wide uppercase opacity-60">
                {namesLabel}
              </p>
              {names.length === 0 && <p className="mt-1 text-sm opacity-70">No entries yet.</p>}
              <ul className="mt-1 flex flex-col gap-2">
                {names.map((entry) => (
                  <li key={entry.name} className="text-sm leading-relaxed">
                    <span className="font-medium">{entry.name}</span>{" "}
                    <span className="text-xs opacity-60">
                      {unit} {entry.chapter}
                    </span>
                    <br />
                    {entry.note}
                  </li>
                ))}
              </ul>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = name.trim();
                  if (trimmed === "") return;
                  onAddName(trimmed);
                  setName("");
                }}
              >
                <input
                  type="text"
                  className="input flex-1 text-base input-sm md:text-sm"
                  placeholder="Add name"
                  aria-label="Add name"
                  value={name}
                  disabled={run !== null}
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-sm"
                  disabled={run !== null || name.trim() === ""}
                >
                  Add
                </button>
              </form>
              {summary.required.length > 0 && (
                <p className="mt-2 text-xs opacity-60">
                  In the next update: {summary.required.join(", ")}
                </p>
              )}
            </>
          )}

          {(summary?.thread ?? []).map((message, index) => (
            <p
              key={index}
              className={`mt-3 text-sm leading-relaxed whitespace-pre-wrap ${message.role === "user" ? "font-medium" : ""}`}
            >
              {message.content}
            </p>
          ))}
          {pending !== null && (
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">
              {pending === "" ? (
                <span className="flex items-center gap-2 opacity-70">
                  {spinner}
                  Waiting for the provider…
                </span>
              ) : (
                pending
              )}
            </p>
          )}
          {askError !== null && <p className="mt-2 text-sm text-error">{askError}</p>}
        </div>

        {consentPending ? (
          <ConsentNote
            provider={settings.provider}
            onCancel={() => setConsentPending(false)}
            onAllow={() => {
              setConsentPending(false);
              onConsent();
              onStart();
            }}
          />
        ) : discardPending ? (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span>The summary is removed. The next run starts from the first {unit}.</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDiscardPending(false)}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={() => {
                  setDiscardPending(false);
                  onDiscard();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        ) : (
          <>
            {error !== null && (
              <p className="mt-2 flex items-center gap-3 text-sm text-error">
                {error}
                <button type="button" className="btn btn-ghost btn-xs" onClick={start}>
                  Retry
                </button>
              </p>
            )}
            {run !== null ? (
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  {spinner}
                  {row}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
                  Stop
                </button>
              </div>
            ) : (
              action !== null && (
                <button
                  type="button"
                  className="btn mt-3 w-full btn-primary btn-sm"
                  onClick={start}
                >
                  {action}
                </button>
              )
            )}

            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                ask();
              }}
            >
              <input
                type="text"
                className="input flex-1 text-base input-sm md:text-sm"
                placeholder="Follow-up…"
                aria-label="Follow-up"
                value={question}
                disabled={summary === null || run !== null || pending !== null}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={
                  summary === null || run !== null || pending !== null || question.trim() === ""
                }
              >
                Send
              </button>
            </form>

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={summary === null}
                onClick={copy}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={summary === null || run !== null}
                onClick={() => setDiscardPending(true)}
              >
                Discard
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
