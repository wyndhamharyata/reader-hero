import { Effect } from "effect";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import {
  ArrowUpIcon,
  ClipboardIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@/components/icons";
import type { AiSettings, BookKind } from "@/domain/ai";
import type { ReaderSettings } from "@/domain/book";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, stopFiber, type Job, type SummaryState } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import type { Chapter } from "@/use-cases/ai-context";
import {
  describeSummary,
  summaryFollowUp,
  type Coverage,
  type SummaryInput,
} from "@/use-cases/summary";
import { ConsentNote } from "./_ConsentNote";
import { NameSheet } from "./_NameSheet";

interface Props {
  input: SummaryInput;
  list: ReadonlyArray<Chapter>;
  cover: Coverage;
  // Null with no provider: the stored summary still reads, and nothing runs.
  settings: AiSettings | null;
  // The book's text settings: the summary is reading text and takes their size, font and leading.
  reading: ReaderSettings;
  state: SummaryState;
  onKind: (kind: BookKind) => void;
  // The chapter to open at, from a line in Contents; null opens at the latest entry.
  openAt: number | null;
  onStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onAddName: (entry: { name: string; note: string; chapter: number }) => void;
  onEditName: (name: string, next: { name: string; note: string } | null) => void;
  onConsent: () => void;
  onClose: () => void;
}

const text = "text-base md:text-sm";
// Fields and their buttons keep the app's font inside the reading text.
const field = "input w-full font-sans text-base md:input-sm md:text-sm";
const button = "btn md:btn-sm";

// Closing the sheet leaves the summary job running; only Stop ends it.
export function SummarySheet({
  input,
  list,
  cover,
  settings,
  reading,
  state,
  onKind,
  openAt,
  onStart,
  onStop,
  onDiscard,
  onAddName,
  onEditName,
  onConsent,
  onClose,
}: Props): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [tab, setTab] = useState<"chapters" | "names">("chapters");
  const [consentPending, setConsentPending] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // The entry open in its own sheet; `entry` is null for a new one.
  const [nameSheet, setNameSheet] = useState<{
    entry: { name: string; note: string } | null;
  } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useTabSwipe(viewport, track, ["chapters", "names"] as const, tab, setTab);
  const opened = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);
  const { summary, run, error } = state;
  const story = input.kind === "story";
  const { row, action } = describeSummary(summary, cover, run, input.kind);
  // A story hides the names from after the position, so the list gives nothing away; the reader's own show.
  const names = (summary?.names ?? []).filter(
    (entry) => !story || entry.edited === true || entry.chapter <= cover.target,
  );
  const unit = story ? "chapter" : "section";
  const namesLabel = story ? "Characters" : "Terms";
  const chapterCount = summary?.chapters.length ?? 0;
  const spinner = <span className="loading loading-sm loading-spinner md:loading-xs" />;

  useEffect(() => {
    if (openAt !== null) setTab("chapters");
  }, [openAt]);
  useEffect(() => {
    if (tab !== "chapters") return;
    const target = openAt !== null && opened.current !== null ? opened.current : latest.current;
    // Not scrollIntoView: it also scrolls the page under the sliding sheet, and the screen jumped.
    const list = body.current;
    if (list === null || target === null) return;
    list.scrollTop = target.offsetTop - list.offsetTop - 8;
  }, [tab, openAt, run?.stage, run?.chapter]);

  useEffect(
    () => () => {
      if (job.current !== null) stopFiber(job.current);
    },
    [],
  );

  const start = (): void => {
    if (settings === null) return;
    if (settings.consentedAt === undefined) {
      setConsentPending(true);
      return;
    }
    onStart();
  };

  const ask = (): void => {
    const asked = question.trim();
    if (settings === null || summary === null || asked === "" || run !== null) return;
    if (pending !== null) return;
    setQuestion("");
    setPending("");
    setAskError(null);
    setTab("chapters");
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

  // A chapter with its own paragraph by now drops its "current position" entry.
  const stored =
    summary?.current !== undefined &&
    !summary.chapters.some((chapter) => chapter.heading === summary.current?.heading)
      ? summary.current
      : undefined;
  const current =
    run !== null && run.stage === "current"
      ? { heading: list[run.chapter - 1]?.heading ?? "", text: run.text }
      : stored === undefined
        ? null
        : { heading: stored.heading, text: stored.text };

  const copy = (): void => {
    if (summary === null) return;
    const copied =
      tab === "chapters"
        ? [
            ...summary.chapters.map((chapter) => `${chapter.heading}\n${chapter.paragraph}`),
            ...(stored === undefined
              ? []
              : [`${stored.heading} · current position\n${stored.text}`]),
          ].join("\n\n")
        : names.map((entry) => `${entry.name}: ${entry.note}`).join("\n");
    void navigator.clipboard.writeText(copied);
  };

  const close = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={close}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Summary"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-auto md:max-w-[calc(100%-2rem)] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Summary · {row}</p>

        <div role="tablist" className="tabs tabs-border mt-1 tabs-lg md:tabs-md">
          {(["chapters", "names"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className={`tab ${tab === value ? "tab-active" : ""}`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "names" ? namesLabel : story ? "Chapters" : "Sections"}
            </button>
          ))}
        </div>

        {/* pan-y leaves sideways moves to the swipe handlers. */}
        <div
          ref={viewport}
          className="-mx-4 mt-1 min-h-0 flex-1 [touch-action:pan-y] overflow-hidden"
        >
          <div
            ref={track}
            // The reader's font, and its line width on desktop; its own layer, so a swipe does not repaint.
            className="flex h-full ease-out will-change-transform motion-safe:transition-transform motion-safe:duration-200 md:w-(--text-width)"
            data-font={reading.font}
            style={
              {
                fontSize: `${reading.fontSize}px`,
                lineHeight: reading.lineHeight,
                transform: `translateX(${tab === "chapters" ? 0 : -100}%)`,
                "--text-width": `${reading.textWidth}ch`,
              } as CSSProperties
            }
          >
            <div
              ref={body}
              className="h-full w-full shrink-0 overflow-y-auto overscroll-contain"
              inert={tab !== "chapters"}
            >
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
                  className="mt-3 px-4 first:mt-0"
                >
                  <p className="font-medium">{chapter.heading}</p>
                  <p className="whitespace-pre-wrap">{chapter.paragraph}</p>
                </div>
              ))}
              {run !== null && run.stage === "chapter" && run.chapter > 0 && (
                <div ref={latest} className="mt-3 px-4 first:mt-0">
                  <p className="font-medium">{list[run.chapter - 1]?.heading ?? ""}</p>
                  <p className="whitespace-pre-wrap">{run.text}</p>
                </div>
              )}
              {current !== null && (
                <div ref={latest} className="mt-3 px-4 first:mt-0">
                  <p className="font-medium">{current.heading} · current position</p>
                  <p className="whitespace-pre-wrap">{current.text}</p>
                </div>
              )}
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
            </div>
            <div
              className="h-full w-full shrink-0 overflow-y-auto overscroll-contain"
              inert={tab !== "names"}
            >
              {names.length === 0 && (
                <p className="px-4 opacity-70">No {namesLabel.toLowerCase()}</p>
              )}
              <ul className="flex flex-col">
                {names.map((entry, index) => (
                  <li key={index} className="px-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-field px-2 py-2 text-left hover:bg-base-300"
                      aria-label={`Edit ${entry.name}`}
                      onClick={() =>
                        setNameSheet({ entry: { name: entry.name, note: entry.note } })
                      }
                    >
                      <span>
                        <span className="font-medium">{entry.name}</span>{" "}
                        <span className="text-[0.75em] opacity-60">
                          {list[entry.chapter - 1]?.heading}
                        </span>
                        <br />
                        {entry.note}
                      </span>
                      <PencilIcon className="size-5 shrink-0 opacity-60 md:size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {summary !== null && (
                <div className="mt-1 px-2 pb-1 font-sans">
                  <button
                    type="button"
                    className="btn w-full justify-start btn-ghost px-2 md:btn-sm"
                    onClick={() => setNameSheet({ entry: null })}
                  >
                    <PlusIcon className="size-6 opacity-60 md:size-4" />
                    {story ? "Add character" : "Add term"}
                  </button>
                </div>
              )}
              {summary !== null && summary.required.length > 0 && (
                <p className="mt-2 px-4 text-[0.75em] opacity-60">
                  Pending: {summary.required.join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>

        {consentPending && settings !== null ? (
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
          <div className={`mt-3 flex items-center justify-between gap-3 ${text}`}>
            <span>The summary is removed. Summarising starts again from the first {unit}.</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className={`${button} btn-ghost`}
                onClick={() => setDiscardPending(false)}
              >
                Keep
              </button>
              <button
                type="button"
                className={`${button} btn-error`}
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
              <p className={`mt-2 flex items-center gap-3 text-error ${text}`}>
                {error}
                <button type="button" className={`${button} btn-ghost`} onClick={start}>
                  Retry
                </button>
              </p>
            )}
            {settings === null ? (
              <p className={`mt-3 opacity-70 ${text}`}>No provider · set in Library Settings</p>
            ) : run !== null ? (
              <div className={`mt-3 flex items-center justify-between gap-3 ${text}`}>
                <span className="flex items-center gap-2">
                  {spinner}
                  {row}
                </span>
                <button type="button" className={`${button} btn-ghost`} onClick={onStop}>
                  Stop
                </button>
              </div>
            ) : (
              action !== null && (
                <button
                  type="button"
                  className={`${button} mt-3 w-full btn-primary`}
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
                className={field}
                placeholder="Ask about the book"
                aria-label="Ask about the book"
                value={question}
                disabled={settings === null || summary === null || run !== null || pending !== null}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                type="submit"
                className={`${button} btn-square btn-primary`}
                aria-label="Send"
                title="Send"
                disabled={
                  settings === null ||
                  summary === null ||
                  run !== null ||
                  pending !== null ||
                  question.trim() === ""
                }
              >
                <ArrowUpIcon className="size-6 md:size-4" />
              </button>
            </form>

            {/* The kind sits here, in the foot, so it takes no row from the content. */}
            <div className="mt-2 flex items-center gap-2">
              <div className="join">
                {(["story", "reference"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${button} join-item px-3 md:px-4 ${input.kind === value ? "btn-neutral" : ""}`}
                    aria-pressed={input.kind === value}
                    disabled={run !== null}
                    onClick={() => onKind(value)}
                  >
                    {value === "story" ? "Story" : "Document"}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Copy"
                title="Copy"
                disabled={summary === null}
                onClick={copy}
              >
                <ClipboardIcon className="size-6 md:size-4" />
              </button>
              <button
                type="button"
                className={`${button} btn-square btn-ghost text-error`}
                aria-label="Discard"
                title="Discard"
                disabled={summary === null || run !== null}
                onClick={() => setDiscardPending(true)}
              >
                <TrashIcon className="size-6 md:size-4" />
              </button>
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Close"
                title="Close"
                onClick={close}
              >
                <XMarkIcon className="size-6 md:size-4" />
              </button>
            </div>
          </>
        )}
      </aside>

      {nameSheet !== null && (
        <NameSheet
          entry={nameSheet.entry}
          story={story}
          onSave={(next) => {
            if (nameSheet.entry === null) {
              // Tagged with the chapter being read, where the reader met the entry.
              onAddName({ ...next, chapter: Math.max(1, Math.min(cover.target + 1, list.length)) });
            } else {
              onEditName(nameSheet.entry.name, next);
            }
          }}
          onRemove={() => {
            if (nameSheet.entry !== null) onEditName(nameSheet.entry.name, null);
          }}
          onClose={() => setNameSheet(null)}
        />
      )}
    </div>
  );
}
