import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Effect } from "effect";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { AiSettings, hasConsent, type BookKind } from "@/domain/ai";
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
import { ChapterList } from "./_ChapterList";
import { SummaryFooter } from "./_SummaryFooter";
import { summaryView } from "./_summary-derived";
import { NameList } from "./_NameList";
import { NameSheet } from "./_NameSheet";

interface Props {
  input: SummaryInput;
  list: ReadonlyArray<Chapter>;
  cover: Coverage;
  // Null with no provider. The stored summary still reads but nothing runs.
  settings: AiSettings | null;
  reading: ReaderSettings;
  state: SummaryState;
  onKind: (kind: BookKind) => void;
  // The chapter to open at, from a line in Contents. Null opens at the latest entry.
  openAt: number | null;
  // Given Allow's settings, so the first run has the consent.
  onStart: (settings?: AiSettings) => void;
  onStop: () => void;
  onDiscard: () => void;
  onAddName: (entry: { name: string; note: string; chapter: number }) => void;
  onEditName: (name: string, next: { name: string; note: string } | null) => void;
  onConsent: () => AiSettings | null;
  onClose: () => void;
  // Set on the bottom sheet, so Back turns to the menu instead of closing both.
  onBack?: () => void;
}

// Closing the sheet keeps the summary job running. Only Stop ends it.
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
  onBack,
}: Props): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [tab, setTab] = useState<"chapters" | "names">("chapters");
  const [consentPending, setConsentPending] = useState<"start" | "ask" | null>(null);
  const [isDiscardPending, setDiscardPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // Only the Contents chapter starts open, so the list stays short. A desktop has room for all.
  const [desktop] = useState(() => window.matchMedia("(width >= 48rem)").matches);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(openAt === null ? [] : [`${openAt}`]),
  );
  // The entry open in its own sheet. `entry` is null for a new one.
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
  const isStory = input.kind === "story";
  const { row, action } = describeSummary(summary, cover, run, input.kind);
  const { visibleChapters, names, unit, namesLabel, current, copied } = summaryView({
    summary,
    cover,
    input,
    run,
    list,
    isStory,
    tab,
  });
  const spinner = <span className="loading loading-sm loading-spinner md:loading-xs" />;

  useEffect(() => {
    if (openAt === null) return;

    setTab("chapters");
    setExpanded((keys) => new Set(keys).add(`${openAt}`));
  }, [openAt]);
  useEffect(() => {
    if (tab !== "chapters") return;

    const target = openAt !== null && opened.current !== null ? opened.current : latest.current;
    // Not scrollIntoView, which also scrolls the page under the sliding sheet. The screen jumped.
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
    if (!hasConsent(settings)) {
      setConsentPending("start");
      return;
    }

    onStart();
  };

  // A question sends summaries and names, so it needs consent as a run does.
  const ask = (allowed: AiSettings | null = settings): void => {
    const asked = question.trim();

    if (allowed === null || summary === null || asked === "" || run !== null) return;
    if (pending !== null) return;
    if (!hasConsent(allowed)) {
      setConsentPending("ask");
      return;
    }

    setQuestion("");
    setPending("");
    setAskError(null);
    setTab("chapters");
    job.current = forkApp(
      summaryFollowUp(input, allowed, summary, asked, setPending).pipe(
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

  const close = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <SheetBackdrop reference={backdropRef} label="Close" onClose={close} />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Summary"
        className="relative z-10 flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:mx-auto md:max-h-[85vh] md:w-auto md:max-w-[calc(100%-2rem)] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
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
              {value === "names" ? namesLabel : isStory ? "Chapters" : "Sections"}
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
            // The reader's font, and its line width on desktop. Its own layer, so a swipe does not repaint.
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
              <ChapterList
                visibleChapters={visibleChapters}
                run={run}
                list={list}
                current={current}
                isDesktop={desktop}
                expanded={expanded}
                setExpanded={setExpanded}
                openAt={openAt}
                opened={opened}
                latest={latest}
                body={body}
                summary={summary}
                unit={unit}
                action={action}
                pending={pending}
                askError={askError}
                spinner={spinner}
              />
            </div>
            <div
              className="h-full w-full shrink-0 overflow-y-auto overscroll-contain"
              inert={tab !== "names"}
            >
              <NameList
                names={names}
                list={list}
                isStory={isStory}
                namesLabel={namesLabel}
                summary={summary}
                onEdit={(entry) => setNameSheet({ entry })}
              />
            </div>
          </div>
        </div>

        <SummaryFooter
          consentPending={consentPending}
          settings={settings}
          onCancelConsent={() => setConsentPending(null)}
          onAllowConsent={() => {
            const then = consentPending;

            setConsentPending(null);

            const allowed = onConsent();

            if (allowed === null) return;

            if (then === "ask") ask(allowed);
            else onStart(allowed);
          }}
          isDiscardPending={isDiscardPending}
          onKeep={() => setDiscardPending(false)}
          onDiscard={() => {
            setDiscardPending(false);
            onDiscard();
          }}
          error={error}
          onRetry={start}
          isRunning={run !== null}
          onStop={onStop}
          action={action}
          onStart={start}
          row={row}
          spinner={spinner}
          question={question}
          onQuestion={setQuestion}
          onAsk={ask}
          hasSummary={summary !== null}
          isAsking={pending !== null}
          onBack={onBack === undefined ? undefined : () => dismiss(onBack)}
          isStory={isStory}
          onKind={() => onKind(isStory ? "reference" : "story")}
          copied={copied}
          onDiscardClick={() => setDiscardPending(true)}
          onClose={close}
          unit={unit}
        />
      </aside>

      {nameSheet !== null && (
        <NameSheet
          entry={nameSheet.entry}
          isStory={isStory}
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
