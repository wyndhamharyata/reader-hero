import { Effect } from "effect";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { ConsentNote } from "@/components/ConsentNote";
import { ArrowUpIcon, EllipsisIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import { ProviderForm } from "@/components/ProviderForm";
import { hasConsent, type AiSettings, type BookKind } from "@/domain/ai";
import type { ReaderFont } from "@/domain/book";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, stopFiber, type Job, type SummaryState } from "@/lib/hooks";
import type { Shelf } from "@/lib/shelf";
import { prefersLessMotion } from "@/lib/open-book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import type { JobState } from "@/services/summary-jobs";
import type { Chapter } from "@/use-cases/ai-context";
import {
  describeSummary,
  summaryFollowUp,
  type Coverage,
  type SummaryInput,
  type SummaryRun,
} from "@/use-cases/summary";
import { CopyButton } from "./_CopyButton";
import { NameList, type NameEntry } from "./_NameList";
import { summaryView } from "./_summary-derived";
import {
  SummaryBody,
  SummaryGhost,
  useEarlierVolumes,
  VolumeRecap,
  type EarlierVolume,
} from "./_SummaryBody";

// Within these chapters, the earlier books' summary opens by itself.
const firstChapters = 3;

type View =
  | { readonly kind: "chapters" }
  | { readonly kind: "names" }
  | { readonly kind: "edit"; readonly entry: NameEntry | null }
  | { readonly kind: "setup" }
  | { readonly kind: "volume"; readonly id: string };

type ListPlace = { readonly id: string; readonly top: number } | null;

// The book's own run, or the series run with the earlier volume it is writing.
function runStatus(
  row: string,
  run: SummaryRun | null,
  series: Shelf["series"][number] | null,
  seriesRun: SummaryRun | null,
): string {
  if (run !== null) return row;

  const writing = series?.books.find((card) => card.book.id === seriesRun?.book);

  return `Before this book · ${writing?.book.title ?? "starting"}`;
}

function panelBody(sheet: HTMLElement | null): HTMLElement | null {
  return sheet?.querySelector<HTMLElement>('[data-pane="chapters"]') ?? null;
}

function bodyTop(sheet: HTMLElement | null): number {
  return panelBody(sheet)?.scrollTop ?? 0;
}

// Back from a volume returns to its row. Otherwise the list opens at the chapter being read. Returns the place still held.
function placeBody(
  body: HTMLElement | null,
  isShown: boolean,
  place: ListPlace,
  heading: HTMLElement | null,
): ListPlace {
  if (body === null || !isShown) return place;

  if (place !== null) {
    body.scrollTop = place.top;
    body.querySelector<HTMLElement>(`[data-volume="${place.id}"]`)?.focus();
    return null;
  }

  if (heading !== null) body.scrollTop = heading.offsetTop - body.offsetTop - 8;

  return place;
}

type Tab = "chapters" | "names";

// The two tabs sit side by side, so a swipe moves between them. The tab switches once the swipe passes halfway.
function useSwipeTabs(
  kind: View["kind"],
  onTab: (tab: Tab) => void,
): {
  readonly panesRef: RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
  readonly show: (tab: Tab) => void;
} {
  const panesRef = useRef<HTMLDivElement>(null);
  const tabAt = (panes: HTMLElement): Tab =>
    panes.scrollLeft > panes.clientWidth / 2 ? "names" : "chapters";

  // Back from a page of its own, the panes open at the tab that was showing.
  useLayoutEffect(() => {
    const panes = panesRef.current;

    if (panes !== null && (kind === "chapters" || kind === "names") && tabAt(panes) !== kind) {
      panes.scrollLeft = kind === "names" ? panes.clientWidth : 0;
    }
  }, [kind]);

  return {
    panesRef,
    onScroll: () => {
      const panes = panesRef.current;

      if (panes !== null && tabAt(panes) !== kind) onTab(tabAt(panes));
    },
    show: (tab) => {
      const panes = panesRef.current;

      // The scroll switches the tab as it passes halfway, as a swipe does.
      panes?.scrollTo({
        left: tab === "names" ? panes.clientWidth : 0,
        behavior: prefersLessMotion() ? "auto" : "smooth",
      });
    },
  };
}

// How far the run has gone, for the bar. A step that is not a chapter fills the bar.
function runRatio(run: SummaryRun | null): number {
  if (run === null || run.stage !== "chapter" || run.of === 0) return 1;

  return Math.max(0.04, (run.chapter - 1) / run.of);
}

// One panel for the book's summary and the earlier books before it: one job, one Stop.
export function SummaryPanel({
  input,
  list,
  cover,
  ai,
  font,
  state,
  series,
  seriesJob,
  bookId,
  openAt,
  onKind,
  onStart,
  onStop,
  onStartOver,
  onSetup,
  onConsent,
  onAddName,
  onEditName,
  onClose,
}: {
  readonly input: SummaryInput;
  readonly list: ReadonlyArray<Chapter>;
  readonly cover: Coverage;
  // Null with no provider. The stored summary still reads, and Summarise opens the setup.
  readonly ai: AiSettings | null;
  readonly font: ReaderFont;
  readonly state: SummaryState;
  readonly series: Shelf["series"][number] | null;
  readonly seriesJob: JobState;
  readonly bookId: string;
  // The chapter to open at, from a line in Contents. Null opens at the latest.
  readonly openAt: number | null;
  readonly onKind: (kind: BookKind) => void;
  // Given the consent's settings, so the first run has it.
  readonly onStart: (settings?: AiSettings) => void;
  readonly onStop: () => void;
  readonly onStartOver: () => void;
  readonly onSetup: (settings: AiSettings) => void;
  readonly onConsent: () => AiSettings | null;
  readonly onAddName: (entry: { name: string; note: string; chapter: number }) => void;
  readonly onEditName: (name: string, next: NameEntry | null) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [view, setView] = useState<View>({ kind: "chapters" });
  const [consentFor, setConsentFor] = useState<"start" | "ask" | null>(null);
  const [isStartingOver, setStartingOver] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NameEntry>({ name: "", note: "" });
  const job = useRef<Job | null>(null);
  const targetRef = useRef<HTMLHeadingElement>(null);
  // Where the list was when a volume opened, so Back returns to that row.
  const listPlace = useRef<ListPlace>(null);
  const [volumesOpen, setVolumesOpen] = useState<boolean | null>(null);
  const { summary, run, error } = state;
  const isStory = input.kind === "story";
  const { visibleChapters, names, unit, namesLabel, current, copied } = summaryView({
    summary,
    cover,
    input,
    run,
    list,
    isStory,
    tab: view.kind === "names" ? "names" : "chapters",
  });
  const { row, action } = describeSummary(summary, cover, run, input.kind);
  const volumes = useEarlierVolumes(series, bookId, seriesJob.run);
  const isRunning = run !== null || seriesJob.run !== null;
  const failure = error ?? seriesJob.error;
  const status = runStatus(row, run, series, seriesJob.run);
  // Either tab: both are in the page, so a swipe between them moves neither list.
  const isMain = view.kind === "chapters" || view.kind === "names";
  const swipe = useSwipeTabs(view.kind, (tab) => setView({ kind: tab }));

  // Not scrollIntoView, which also scrolls the page under a sliding sheet.
  useEffect(() => {
    listPlace.current = placeBody(
      panelBody(sheetRef.current),
      isMain,
      listPlace.current,
      targetRef.current,
    );
  }, [openAt, isMain, run?.chapter, summary]);

  useEffect(
    () => () => {
      if (job.current !== null) stopFiber(job.current);
    },
    [],
  );

  const start = (): void => {
    if (ai === null) {
      setView({ kind: "setup" });
      return;
    }
    if (!hasConsent(ai)) {
      // The consent note shows under the chapters, so that tab opens first.
      setView({ kind: "chapters" });
      setConsentFor("start");
      return;
    }

    onStart();
  };

  // A question sends summaries and names, so it needs consent as a run does.
  const ask = (allowed: AiSettings | null = ai): void => {
    const asked = question.trim();

    if (allowed === null || summary === null || asked === "" || isRunning || pending !== null) {
      return;
    }
    if (!hasConsent(allowed)) {
      setConsentFor("ask");
      return;
    }

    setQuestion("");
    setPending("");
    setAskError(null);
    job.current = forkApp(
      summaryFollowUp(input, allowed, summary, asked, setPending).pipe(
        Effect.match({
          onSuccess: () => setPending(null),
          onFailure: (failed) => {
            setPending(null);
            setAskError(describeAiFailure(failed));
          },
        }),
      ),
    );
  };

  const close = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  const panelProps = { sheetRef, backdropRef, docks: true, onDismiss: close };

  if (view.kind === "setup") {
    return (
      <Panel
        {...panelProps}
        label="Choose a provider"
        title="Choose a provider"
        onBack={() => setView({ kind: "chapters" })}
      >
        <ProviderForm
          ai={ai}
          isSetup
          onSave={(next) => {
            onSetup(next);
            setView({ kind: "chapters" });
          }}
        />
      </Panel>
    );
  }

  if (view.kind === "edit") {
    return (
      <NameEditPanel
        {...panelProps}
        entry={view.entry}
        draft={draft}
        isStory={isStory}
        onDraft={setDraft}
        onBack={() => setView({ kind: "names" })}
        onSave={(next) => {
          // Tagged with the chapter being read, where the reader met the entry.
          const chapter = Math.max(1, Math.min(cover.target + 1, list.length));

          if (view.entry === null) onAddName({ ...next, chapter });
          else onEditName(view.entry.name, next);

          setView({ kind: "names" });
        }}
        onRemove={(name) => {
          onEditName(name, null);
          setView({ kind: "names" });
        }}
      />
    );
  }

  if (view.kind === "volume") {
    return (
      <VolumePanel
        {...panelProps}
        volume={volumes.find((entry) => entry.card.book.id === view.id)}
        font={font}
        onBack={() => setView({ kind: "chapters" })}
      />
    );
  }

  const openVolume = (id: string): void => {
    listPlace.current = { id, top: bodyTop(sheetRef.current) };
    setView({ kind: "volume", id });
  };

  const edit = (entry: NameEntry | null): void => {
    setDraft(entry ?? { name: "", note: "" });
    setView({ kind: "edit", entry });
  };

  const menu = (
    <SummaryMenu
      kind={input.kind}
      copied={copied}
      isRunning={isRunning}
      hasSummary={summary !== null}
      onKind={onKind}
      onStartOver={() => setStartingOver(true)}
    />
  );

  const tabs = (
    <div className="panel-tabs latch-row flex" role="group" aria-label="Show">
      <button
        type="button"
        className="key"
        aria-pressed={view.kind === "chapters"}
        onClick={() => swipe.show("chapters")}
      >
        {isStory ? "Chapters" : "Sections"}
      </button>
      <button
        type="button"
        className="key"
        aria-pressed={view.kind === "names"}
        onClick={() => swipe.show("names")}
      >
        {namesLabel}
      </button>
    </div>
  );

  const runningFoot = (
    <div className="flex items-center gap-3">
      <span className="meter stripes flex-1">
        <span style={{ width: `${runRatio(run) * 100}%` }} />
      </span>
      <span className="max-w-[55%] truncate text-[13.5px] text-(--ink-soft)">{status}</span>
      <button type="button" className="key small" onClick={onStop}>
        Stop
      </button>
    </div>
  );

  const chaptersFoot = (): ReactElement => {
    if (consentFor !== null && ai !== null) {
      return (
        <ConsentNote
          provider={ai.provider}
          onCancel={() => setConsentFor(null)}
          onAllow={() => {
            const then = consentFor;
            const allowed = onConsent();

            setConsentFor(null);
            if (allowed === null) return;

            if (then === "ask") ask(allowed);
            else onStart(allowed);
          }}
        />
      );
    }

    if (isStartingOver) {
      return (
        <div className="confirm mt-0">
          <p>Start over? The summary goes and begins again from the first {unit}.</p>
          <div className="buttons">
            <button type="button" className="key small" onClick={() => setStartingOver(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="key small danger"
              onClick={() => {
                setStartingOver(false);
                onStartOver();
              }}
            >
              Start over
            </button>
          </div>
        </div>
      );
    }

    if (failure !== null) {
      return (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-(--red)">{failure}</p>
          <button type="button" className="key small" onClick={start}>
            Retry
          </button>
        </div>
      );
    }

    if (isRunning) return runningFoot;

    if (summary === null) {
      return (
        <div className="flex flex-col gap-2.5">
          <p className="py-1 text-center font-semibold">
            {action === null ? "Nothing read yet" : "No summary yet"}
          </p>
          {action !== null && (
            <button type="button" className="key green" onClick={start}>
              Summarise up to here
            </button>
          )}
        </div>
      );
    }

    return (
      <>
        {action !== null && (
          <div>
            <button type="button" className="key small" onClick={start}>
              {action}
            </button>
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <span className="field min-h-11 flex-1">
            <input
              type="text"
              placeholder="Ask about the book"
              aria-label="Ask about the book"
              value={question}
              disabled={pending !== null}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </span>
          <button
            type="submit"
            className="key green round size-11"
            aria-label="Send"
            disabled={question.trim() === "" || pending !== null}
          >
            <ArrowUpIcon className="icon" />
          </button>
        </form>
      </>
    );
  };

  const namesFoot = isRunning ? (
    runningFoot
  ) : (
    <div className="flex gap-2.5">
      <button
        type="button"
        className="key flex-1"
        disabled={summary === null}
        onClick={() => edit(null)}
      >
        {isStory ? "Add character" : "Add term"}
      </button>
      <button
        type="button"
        className="key green flex-1"
        disabled={summary === null}
        onClick={start}
      >
        {isStory ? "Update characters" : "Update terms"}
      </button>
    </div>
  );

  return (
    <Panel
      {...panelProps}
      label="Summary"
      title="Summary"
      actions={menu}
      tabs={tabs}
      foot={view.kind === "names" ? namesFoot : chaptersFoot()}
    >
      <div ref={swipe.panesRef} className="panes" data-font={font} onScroll={swipe.onScroll}>
        <div className="pane" data-pane="chapters" inert={view.kind !== "chapters"}>
          {summary === null && !isRunning ? (
            <SummaryGhost list={list} target={cover.target} volumes={volumes} />
          ) : (
            <SummaryBody
              summary={summary}
              chapters={visibleChapters}
              run={run}
              list={list}
              current={current}
              volumes={volumes}
              isFirstChapters={cover.target < firstChapters}
              openAt={openAt}
              pending={pending}
              askError={askError}
              targetRef={targetRef}
              volumesOpen={volumesOpen}
              onVolumesOpen={setVolumesOpen}
              onVolume={openVolume}
            />
          )}
        </div>
        <div className="pane" inert={view.kind !== "names"}>
          <NameList names={names} summary={summary} namesLabel={namesLabel} onEdit={edit} />
        </div>
      </div>
    </Panel>
  );
}

function SummaryMenu({
  kind,
  copied,
  isRunning,
  hasSummary,
  onKind,
  onStartOver,
}: {
  readonly kind: BookKind;
  readonly copied: string;
  readonly isRunning: boolean;
  readonly hasSummary: boolean;
  readonly onKind: (kind: BookKind) => void;
  readonly onStartOver: () => void;
}): ReactElement {
  const [isOpen, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="key small square"
        aria-label="More"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        <EllipsisIcon className="icon" />
      </button>
      {isOpen && (
        <div className="rise absolute top-full right-0 z-10 mt-2 w-60 rounded-2xl border border-(--line) bg-(--surface) p-2 shadow-(--shadow-panel)">
          <div className="latch-row flex" role="group" aria-label="This book is">
            {(["story", "reference"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="key flex-1"
                aria-pressed={kind === value}
                disabled={isRunning}
                onClick={() => onKind(value)}
              >
                {value === "story" ? "Story" : "Document"}
              </button>
            ))}
          </div>
          <div className="rows mt-2">
            <CopyButton text={copied} />
            <button
              type="button"
              className="row-item"
              disabled={!hasSummary || isRunning}
              onClick={() => {
                setOpen(false);
                onStartOver();
              }}
            >
              <span className="row-label text-(--red)">Start over</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// One character or term at a time, in place of the list, with Back. No sheet over a sheet.
function VolumePanel({
  volume,
  font,
  onBack,
  ...panelProps
}: {
  readonly sheetRef: RefObject<HTMLElement | null>;
  readonly backdropRef: RefObject<HTMLButtonElement | null>;
  readonly docks: boolean;
  readonly onDismiss: () => void;
  readonly volume: EarlierVolume | undefined;
  readonly font: ReaderFont;
  readonly onBack: () => void;
}): ReactElement {
  const title = volume?.title ?? "";

  return (
    <Panel {...panelProps} label={title} title={title} onBack={onBack}>
      <div data-font={font}>{volume !== undefined && <VolumeRecap volume={volume} />}</div>
    </Panel>
  );
}

function NameEditPanel({
  sheetRef,
  backdropRef,
  docks,
  onDismiss,
  entry,
  draft,
  isStory,
  onDraft,
  onBack,
  onSave,
  onRemove,
}: {
  readonly sheetRef: RefObject<HTMLElement | null>;
  readonly backdropRef: RefObject<HTMLButtonElement | null>;
  readonly docks: boolean;
  readonly onDismiss: () => void;
  // Null for a new one.
  readonly entry: NameEntry | null;
  readonly draft: NameEntry;
  readonly isStory: boolean;
  readonly onDraft: (draft: NameEntry) => void;
  readonly onBack: () => void;
  readonly onSave: (next: NameEntry) => void;
  readonly onRemove: (name: string) => void;
}): ReactElement {
  const label = isStory ? "Character" : "Term";
  const name = draft.name.trim();

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      docks={docks}
      onDismiss={onDismiss}
      label={label}
      title={label}
      onBack={onBack}
      foot={
        <div className="flex gap-2.5">
          {entry !== null && (
            <button
              type="button"
              className="key danger flex-1"
              onClick={() => onRemove(entry.name)}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className="key green flex-1"
            disabled={name === ""}
            onClick={() => onSave({ name, note: draft.note.trim() })}
          >
            {entry === null ? "Add" : "Save"}
          </button>
        </div>
      }
    >
      <label className="field-label mt-1" htmlFor="name-name">
        Name
      </label>
      <span className="field">
        <input
          id="name-name"
          type="text"
          className="font-semibold"
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
        />
      </span>
      <label className="field-label" htmlFor="name-note">
        Note
      </label>
      <span className="field area">
        <textarea
          id="name-note"
          rows={4}
          value={draft.note}
          onChange={(event) => onDraft({ ...draft, note: event.target.value })}
        />
      </span>
    </Panel>
  );
}
