import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { AiSettings } from "@/domain/ai";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, stopFiber, type Job, type SummaryState } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { chapters } from "@/use-cases/ai-context";
import { describeSummary, summaryFollowUp, type SummaryInput } from "@/use-cases/summary";
import { ConsentNote } from "./_ConsentNote";

interface Props {
  input: SummaryInput;
  settings: AiSettings;
  state: SummaryState;
  // The chapter to open at, from a line in Contents; null opens at the latest chapter.
  openAt: number | null;
  onStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onAddName: (name: string) => void;
  onConsent: () => void;
  onClose: () => void;
}

// The book's whole summary: its chapters and the names drawn from them. The one action, in the
// foot, runs the job for the chapters it does not cover yet; the newest chapter streams in below
// the stored ones. Closing the sheet does not stop the job.
export function SummarySheet({
  input,
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
  const [segment, setSegment] = useState<"chapters" | "names">("chapters");
  const [consentPending, setConsentPending] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const opened = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);
  const { summary, run, error } = state;
  const story = input.kind === "story";
  const list = useMemo(() => chapters(input.parsed), [input.parsed]);
  const { row, action } = describeSummary(summary, input.target, run, input.kind);
  const length = settings.summaryLength;
  // A story shows no name whose first chapter is after the position.
  const names = (summary?.names ?? []).filter((entry) => !story || entry.chapter <= input.target);
  const units: readonly [string, string] = story
    ? ["Chapters", "Characters"]
    : ["Sections", "Terms"];

  // Opens at the chapter tapped in Contents, or at the latest; a new chapter in flight scrolls into view.
  useEffect(() => {
    if (segment !== "chapters") return;
    if (openAt !== null && opened.current !== null) {
      opened.current.scrollIntoView({ block: "start" });
    } else if (body.current !== null) {
      body.current.scrollTop = body.current.scrollHeight;
    }
  }, [openAt, segment, run?.chapter]);

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
    const text =
      segment === "chapters"
        ? (summary?.chapters ?? [])
            .map(
              (chapter) =>
                `${chapter.heading}\n${length === "line" ? chapter.line : chapter.paragraph}`,
            )
            .join("\n\n")
        : names.map((entry) => `${entry.name}: ${entry.note}`).join("\n");
    void navigator.clipboard.writeText(text);
  };

  const close = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  const spinner = <span className="loading loading-xs loading-spinner" />;

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

        <div className="mt-2 flex gap-2">
          {(["chapters", "names"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn rounded-full btn-xs ${segment === value ? "btn-neutral" : ""}`}
              aria-pressed={segment === value}
              onClick={() => setSegment(value)}
            >
              {value === "chapters" ? units[0] : units[1]}
            </button>
          ))}
        </div>

        <div ref={body} className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {segment === "chapters" ? (
            <>
              {(summary?.chapters ?? []).map((chapter, index) => (
                <div
                  key={index}
                  ref={index === openAt ? opened : undefined}
                  className="mt-3 first:mt-0"
                >
                  <p className="text-sm font-medium">{chapter.heading}</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {length === "line" ? chapter.line : chapter.paragraph}
                  </p>
                </div>
              ))}
              {run !== null && run.stage === "chapter" && (
                <div className="mt-3 first:mt-0">
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
                  {units[1]}…
                </p>
              )}
              {summary === null && run === null && (
                <p className="text-sm opacity-70">
                  {input.target === 0
                    ? `No ${units[0].toLowerCase()} before this position.`
                    : "Nothing summarised yet."}
                </p>
              )}
            </>
          ) : (
            <>
              {names.length === 0 && <p className="text-sm opacity-70">No entries yet.</p>}
              <ul className="flex flex-col gap-2">
                {names.map((entry) => (
                  <li key={entry.name} className="text-sm leading-relaxed">
                    <span className="font-medium">{entry.name}</span>{" "}
                    <span className="text-xs opacity-60">
                      {story ? "chapter" : "section"} {entry.chapter}
                    </span>
                    <br />
                    {entry.note}
                  </li>
                ))}
              </ul>
              {summary !== null && (
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
              )}
              {summary !== null && summary.required.length > 0 && (
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
            <span>The summary is removed. The next run starts from the first chapter.</span>
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
