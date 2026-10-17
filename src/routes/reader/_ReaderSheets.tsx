import { Effect } from "effect";
import type { ReactElement } from "react";
import { AiSettings, CONSENT_VERSION, type Summary } from "@/domain/ai";
import type { BookPrefs, ReaderSettings, TocEntry } from "@/domain/book";
import { forkApp } from "@/lib/hooks";
import type { Shelf } from "@/lib/shelf";
import { SummaryJobs, type JobState } from "@/services/summary-jobs";
import type { Chapter } from "@/use-cases/ai-context";
import type { Coverage, SummaryInput, SummaryRun } from "@/use-cases/summary";
import { MenuSheet } from "./_MenuSheet";
import { SeriesSheet } from "./_SeriesSheet";
import { SummarySheet } from "./_SummarySheet";

export function ReaderSheets({
  isTocOpen,
  toc,
  modeLabel,
  bookSettings,
  summaryText,
  run,
  stop,
  series,
  seriesJob,
  reloadSeries,
  setSeriesOpen,
  seriesId,
  lines,
  onSelect,
  chapterList,
  setSummarySheet,
  isEpub,
  toggleMode,
  changeSettings,
  closeToc,
  summarySheet,
  summaryInput,
  cover,
  ai,
  summary,
  summaryError,
  savePrefs,
  start,
  discard,
  addName,
  editName,
  putAi,
  setTocOpen,
  isSeriesOpen,
  bookId,
}: {
  readonly isTocOpen: boolean;
  readonly toc: ReadonlyArray<TocEntry>;
  readonly modeLabel: string;
  readonly bookSettings: ReaderSettings;
  readonly summaryText: { readonly row: string };
  readonly run: SummaryRun | null;
  readonly stop: () => void;
  readonly series: Shelf["series"][number] | null;
  readonly seriesJob: JobState;
  readonly reloadSeries: () => void;
  readonly setSeriesOpen: (isOpen: boolean) => void;
  readonly seriesId: string | null;
  readonly lines: ReadonlyMap<number, string>;
  readonly onSelect: (blockIndex: number) => void;
  readonly chapterList: ReadonlyArray<Chapter>;
  readonly setSummarySheet: (value: { openAt: number | null } | null) => void;
  readonly isEpub: boolean;
  readonly toggleMode: () => void;
  readonly changeSettings: (patch: Partial<ReaderSettings>) => void;
  readonly closeToc: () => void;
  readonly summarySheet: { readonly openAt: number | null } | null;
  readonly summaryInput: SummaryInput | null;
  readonly cover: Coverage;
  readonly ai: AiSettings | null;
  readonly summary: Summary | null;
  readonly summaryError: string | null;
  readonly savePrefs: (changes: Partial<BookPrefs>) => void;
  readonly start: (input: SummaryInput, settings: AiSettings) => void;
  readonly discard: () => void;
  readonly addName: (entry: { name: string; note: string; chapter: number }) => void;
  readonly editName: (name: string, next: { name: string; note: string } | null) => void;
  readonly putAi: (next: AiSettings | null) => void;
  readonly setTocOpen: (isOpen: boolean) => void;
  readonly isSeriesOpen: boolean;
  readonly bookId: string;
}): ReactElement {
  return (
    <>
      <MenuSheet
        isOpen={isTocOpen}
        toc={toc}
        modeLabel={modeLabel}
        settings={bookSettings}
        summary={summaryText.row}
        isSummaryRunning={run !== null}
        onSummary={() => setSummarySheet({ openAt: null })}
        onStopSummary={stop}
        series={
          series === null
            ? null
            : `${series.name} · ${series.books.findIndex((card) => card.book.id === bookId) + 1} of ${series.count}`
        }
        isSeriesRunning={seriesJob.run !== null}
        onSeries={() => {
          // The badges follow the reading done since the book opened.
          reloadSeries();
          setSeriesOpen(true);
        }}
        onStopSeries={() => {
          forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.stop(`series:${seriesId}`)));
        }}
        lines={lines}
        onSelect={onSelect}
        onLine={(blockIndex) => {
          const index = chapterList.findIndex((chapter) => chapter.start === blockIndex);

          setSummarySheet({ openAt: index === -1 ? null : index });
        }}
        onToggleMode={isEpub ? undefined : toggleMode}
        onSettingsChange={changeSettings}
        onClose={closeToc}
      />

      {summarySheet !== null && summaryInput !== null && (
        <SummarySheet
          input={summaryInput}
          list={chapterList}
          cover={cover}
          settings={ai}
          reading={bookSettings}
          state={{ summary, run, error: summaryError }}
          onKind={(next) => savePrefs({ kind: next })}
          openAt={summarySheet.openAt}
          onStart={(allowed) => {
            const settings = allowed ?? ai;

            if (settings !== null) start(summaryInput, settings);
          }}
          onStop={stop}
          onDiscard={discard}
          onAddName={addName}
          onEditName={editName}
          onConsent={() => {
            if (ai === null) return null;

            const allowed = new AiSettings({
              ...ai,
              consentedAt: Date.now(),
              consentVersion: CONSENT_VERSION,
            });

            putAi(allowed);

            return allowed;
          }}
          onClose={() => setSummarySheet(null)}
          onBack={() => setTocOpen(true)}
        />
      )}

      {isSeriesOpen && series !== null && (
        <SeriesSheet
          series={series}
          bookId={bookId}
          settings={ai}
          reading={bookSettings}
          state={seriesJob}
          onStart={() => {
            if (ai !== null) {
              forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.startSeries(series, bookId, ai)));
            }
          }}
          onStop={() => {
            forkApp(Effect.flatMap(SummaryJobs, (jobs) => jobs.stop(`series:${series.id}`)));
          }}
          onConsent={() => {
            if (ai === null) return;

            putAi(
              new AiSettings({ ...ai, consentedAt: Date.now(), consentVersion: CONSENT_VERSION }),
            );
          }}
          onClose={() => setSeriesOpen(false)}
          onBack={() => setTocOpen(true)}
        />
      )}
    </>
  );
}
