import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
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
  onAddName: (name: string) => void;
  onEditName: (index: number, next: { name: string; note: string } | null) => void;
  onConsent: () => void;
  onClose: () => void;
}

// Phone-first sizes, as the menu sheet: 16px text and 44px controls, smaller from md up.
const text = "text-base md:text-sm";
// Fields and their buttons keep the app's font inside the reading text.
const field = "input w-full font-sans text-base md:input-sm md:text-sm";
const button = "btn md:btn-sm";

// The book's whole summary: a Chapters tab with the chapters before the position and the chapter
// being read up to it, and a Characters tab the reader can edit by tapping a row. The one action,
// in the foot, brings it up to the position; the entry in flight streams in place, and the foot's
// status line is the one place that shows the job running. Closing the sheet does not stop the job.
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
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ index: number; name: string; note: string } | null>(
    null,
  );
  const body = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const slide = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  const offsetOf = (which: "chapters" | "names"): string =>
    which === "chapters" ? "translateX(0)" : "translateX(-100%)";

  // A sideways swipe drags the track of the two tabs along with the finger and snaps on release.
  // The axis locks on the first move: sideways, the track owns the touch and the panel under the
  // finger does not scroll; otherwise the panel scrolls and the track stays. Native listeners,
  // since React's touchmove is passive and cannot cancel the scroll.
  useEffect(() => {
    const box = viewport.current;
    const rail = track.current;
    if (box === null || rail === null) return;
    let state: {
      x: number;
      y: number;
      at: number;
      width: number;
      axis: "none" | "x" | "y";
      dx: number;
    } | null = null;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      state =
        touch === undefined
          ? null
          : {
              x: touch.clientX,
              y: touch.clientY,
              at: event.timeStamp,
              width: box.clientWidth,
              axis: "none",
              dx: 0,
            };
    };
    const onMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (state === null || touch === undefined) return;
      const dx = touch.clientX - state.x;
      const dy = touch.clientY - state.y;
      if (state.axis === "none") {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        state.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (state.axis === "x") rail.style.transition = "none";
      }
      if (state.axis !== "x") return;
      event.preventDefault();
      state.dx = dx;
      const base = tab === "chapters" ? 0 : -state.width;
      rail.style.transform = `translateX(${Math.max(-state.width, Math.min(0, base + dx))}px)`;
    };
    const settle = (next: "chapters" | "names"): void => {
      rail.style.transition = `transform ${slide}ms ease-out`;
      rail.style.transform = offsetOf(next);
      setTab(next);
    };
    const onEnd = (event: TouchEvent): void => {
      const done = state;
      state = null;
      if (done === null || done.axis !== "x") return;
      const speed = Math.abs(done.dx) / Math.max(1, event.timeStamp - done.at);
      const far = Math.abs(done.dx) > done.width / 4 || (Math.abs(done.dx) > 30 && speed > 0.5);
      settle(!far ? tab : done.dx < 0 ? "names" : "chapters");
    };
    const onCancel = (): void => {
      state = null;
      settle(tab);
    };
    box.addEventListener("touchstart", onStart, { passive: true });
    box.addEventListener("touchmove", onMove, { passive: false });
    box.addEventListener("touchend", onEnd);
    box.addEventListener("touchcancel", onCancel);
    return () => {
      box.removeEventListener("touchstart", onStart);
      box.removeEventListener("touchmove", onMove);
      box.removeEventListener("touchend", onEnd);
      box.removeEventListener("touchcancel", onCancel);
    };
  }, [tab, slide]);
  const opened = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);
  const { summary, run, error } = state;
  const story = input.kind === "story";
  const { row, action } = describeSummary(summary, cover, run, input.kind);
  // A story shows no name whose first chapter is after the position.
  const names = (summary?.names ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !story || entry.chapter <= cover.target);
  const unit = story ? "chapter" : "section";
  const namesLabel = story ? "Characters" : "Terms";
  const chapterCount = summary?.chapters.length ?? 0;
  const spinner = <span className="loading loading-sm loading-spinner md:loading-xs" />;

  // A line tapped in Contents opens the Chapters tab at that chapter; otherwise the latest entry,
  // or the one in flight, comes into view.
  useEffect(() => {
    if (openAt !== null) setTab("chapters");
  }, [openAt]);
  useEffect(() => {
    if (tab !== "chapters") return;
    const target = openAt !== null && opened.current !== null ? opened.current : latest.current;
    // The list scrolls on its own: scrollIntoView would also scroll the page under the sheet while
    // the sheet is still sliding in, and the whole screen jumped.
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

  // The entry for the chapter being read: the one in flight, else the stored one, unless that
  // chapter has its own paragraph by now.
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
            ...(stored === undefined ? [] : [`${stored.heading} · to here\n${stored.text}`]),
          ].join("\n\n")
        : names.map(({ entry }) => `${entry.name}: ${entry.note}`).join("\n");
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
        className="absolute inset-0 bg-black/50 motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={close}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Summary"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:rounded-box md:pb-4"
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
              {value === "chapters" ? "Chapters" : namesLabel}
            </button>
          ))}
        </div>

        {/* The two tabs sit side by side in a track; pan-y leaves sideways moves to the handlers. */}
        <div
          ref={viewport}
          className="-mx-4 mt-1 min-h-0 flex-1 [touch-action:pan-y] overflow-hidden"
        >
          <div
            ref={track}
            className="flex h-full"
            data-font={reading.font}
            style={{
              fontSize: `${reading.fontSize}px`,
              lineHeight: reading.lineHeight,
              transform: offsetOf(tab),
              transition: `transform ${slide}ms ease-out`,
            }}
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
                  <p className="font-medium">{current.heading} · to here</p>
                  <p className="whitespace-pre-wrap">{current.text}</p>
                </div>
              )}
              {summary === null && run === null && (
                <p className="px-4 opacity-70">
                  {action === null
                    ? `No ${unit}s before this position.`
                    : "Nothing summarised yet."}
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
                      Waiting for the provider…
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
              {names.length === 0 && <p className="px-4 opacity-70">No entries yet.</p>}
              <ul className="flex flex-col">
                {names.map(({ entry, index }) =>
                  editing !== null && editing.index === index ? (
                    <li key={index} className="px-4 py-2">
                      <form
                        className="flex flex-col gap-2 font-sans"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (editing.name.trim() === "") return;
                          onEditName(index, {
                            name: editing.name.trim(),
                            note: editing.note.trim(),
                          });
                          setEditing(null);
                        }}
                      >
                        <input
                          type="text"
                          className={field}
                          aria-label="Name"
                          value={editing.name}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        />
                        <input
                          type="text"
                          className={field}
                          aria-label="Note"
                          value={editing.note}
                          onChange={(event) => setEditing({ ...editing, note: event.target.value })}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className={`${button} btn-ghost text-error`}
                            onClick={() => {
                              onEditName(index, null);
                              setEditing(null);
                            }}
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            className={`${button} btn-ghost`}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className={`${button} btn-primary`}
                            disabled={editing.name.trim() === ""}
                          >
                            Save
                          </button>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={index} className="px-2">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-field px-2 py-2 text-left hover:bg-base-300 disabled:opacity-50"
                        aria-label={`Edit ${entry.name}`}
                        disabled={run !== null}
                        onClick={() => setEditing({ index, name: entry.name, note: entry.note })}
                      >
                        <span>
                          <span className="font-medium">{entry.name}</span>{" "}
                          <span className="text-[0.75em] opacity-60">
                            {unit} {entry.chapter}
                          </span>
                          <br />
                          {entry.note}
                        </span>
                        <PencilIcon className="size-5 shrink-0 opacity-60 md:size-4" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {summary !== null && (
                <form
                  className="mt-3 flex gap-2 px-4 pb-1 font-sans"
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
                    className={field}
                    placeholder="Add name"
                    aria-label="Add name"
                    value={name}
                    disabled={run !== null}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    type="submit"
                    className={`${button} btn-square`}
                    aria-label="Add"
                    disabled={run !== null || name.trim() === ""}
                  >
                    <PlusIcon className="size-6 md:size-4" />
                  </button>
                </form>
              )}
              {summary !== null && summary.required.length > 0 && (
                <p className="mt-2 px-4 text-[0.75em] opacity-60">
                  In the next update: {summary.required.join(", ")}
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
            <span>The summary is removed. The next run starts from the first {unit}.</span>
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
              <p className={`mt-3 opacity-70 ${text}`}>
                No provider · set in the library's Settings
              </p>
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
                placeholder="Follow-up…"
                aria-label="Follow-up"
                value={question}
                disabled={settings === null || summary === null || run !== null || pending !== null}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                type="submit"
                className={`${button} btn-square btn-primary`}
                aria-label="Send"
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
                disabled={summary === null}
                onClick={copy}
              >
                <ClipboardIcon className="size-6 md:size-4" />
              </button>
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Discard"
                disabled={summary === null || run !== null}
                onClick={() => setDiscardPending(true)}
              >
                <TrashIcon className="size-6 md:size-4" />
              </button>
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Close"
                onClick={close}
              >
                <XMarkIcon className="size-6 md:size-4" />
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
