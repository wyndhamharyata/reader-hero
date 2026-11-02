import { Effect, Stream } from "effect";
import { useEffect, useMemo, useState } from "react";
import type { AiSettings, Summary } from "@/domain/ai";
import {
  FINISHED_PERCENT,
  ReaderSettings,
  type BookMeta,
  type BookPrefs,
  type ParsedBook,
  type ReadingProgress,
  type ReaderMode,
  type TocEntry,
} from "@/domain/book";
import { forkApp, stopFiber, useAppEffect } from "@/lib/hooks";
import { guessKind } from "@/lib/guess-kind";
import { guessMode } from "@/lib/guess-mode";
import type { Shelf } from "@/lib/shelf";
import { SummaryJobs, type JobState } from "@/services/summary-jobs";
import { chapters } from "@/use-cases/ai-context";
import { findBookSeries } from "@/use-cases/series";
import { coverage, type Coverage, type SummaryInput } from "@/use-cases/summary";

export interface LoadedBook {
  readonly meta: BookMeta;
  readonly parsed: ParsedBook;
  readonly progress: ReadingProgress | null;
  readonly prefs: BookPrefs | null;
}

export function useBookSeries(
  bookId: string,
  isLoaded: boolean,
): {
  readonly series: Shelf["series"][number] | null;
  readonly seriesId: string | null;
  readonly seriesJob: JobState;
  readonly reloadSeries: () => void;
} {
  const { state: seriesState, reload: reloadSeries } = useAppEffect(
    Effect.gen(function* () {
      if (!isLoaded) return null;

      return yield* findBookSeries(bookId);
    }),
    [bookId, isLoaded],
  );
  const series = seriesState.status === "done" ? seriesState.value : null;
  const seriesId = series?.id ?? null;
  // The series summary's run, kept here so the Summary panel shows it as part of its own run.
  const [seriesJob, setSeriesJob] = useState<JobState>({ run: null, error: null });

  useEffect(() => {
    if (seriesId === null) return;

    const fiber = forkApp(
      Effect.flatMap(SummaryJobs, (jobs) =>
        jobs
          .state(`series:${seriesId}`)
          .pipe(Stream.runForEach((next) => Effect.sync(() => setSeriesJob(next)))),
      ),
    );

    return () => stopFiber(fiber);
  }, [seriesId]);

  return { series, seriesId, seriesJob, reloadSeries };
}

export function useBookSettings(
  settings: ReaderSettings,
  data: LoadedBook | null,
  glance: { readonly prefs: BookPrefs | null } | undefined,
  prefChanges: Partial<BookPrefs>,
): { readonly prefs: Partial<BookPrefs>; readonly bookSettings: ReaderSettings } {
  // The book's saved choices, with this visit's changes on top until a reload reads them back.
  const prefs = useMemo<Partial<BookPrefs>>(
    () => ({ ...(data === null ? glance?.prefs : data.prefs), ...prefChanges }),
    [data, glance, prefChanges],
  );
  // Memoised so a position change does not hand the memoised reader view a new settings object.
  const bookSettings = useMemo(
    () =>
      new ReaderSettings({
        ...settings,
        // Theme and warmth are global for every book, so a book's own stored choice of either is not read.
        font: prefs.font ?? settings.font,
        fontSize: prefs.fontSize ?? settings.fontSize,
        lineHeight: prefs.lineHeight ?? settings.lineHeight,
        textAlign: prefs.textAlign ?? settings.textAlign,
        textWidth: prefs.textWidth ?? settings.textWidth,
      }),
    [settings, prefs],
  );

  return { prefs, bookSettings };
}

export function useBookKind(
  data: LoadedBook | null,
  prefs: Partial<BookPrefs>,
): {
  readonly guessed: ReturnType<typeof guessMode>;
  readonly kind: ReturnType<typeof guessKind>;
  readonly isEpub: boolean;
} {
  const guessed = useMemo(
    () => (data === null ? "reader" : guessMode(data.meta, data.parsed)),
    [data],
  );
  const guessedKind = useMemo(
    () => (data === null ? "story" : guessKind(data.meta, data.parsed)),
    [data],
  );
  const kind = prefs.kind ?? guessedKind;
  // An EPUB has no pages to show, so it always reads in reader mode.
  const isEpub = data?.meta.format === "epub";

  return { guessed, kind, isEpub };
}

export function useSummaryView({
  data,
  ai,
  summary,
  kind,
  position,
  furthest,
}: {
  readonly data: LoadedBook | null;
  readonly ai: AiSettings | null;
  readonly summary: Summary | null;
  readonly kind: ReturnType<typeof guessKind>;
  readonly position: number;
  readonly furthest: number;
}): {
  readonly chapterList: ReturnType<typeof chapters>;
  readonly readingIndex: number;
  readonly isFinished: boolean;
  readonly cover: Coverage;
  readonly readingCover: Coverage;
  readonly summaryInput: SummaryInput | null;
  readonly autoSummaryInput: SummaryInput | null;
  readonly lines: ReadonlyMap<number, string>;
} {
  const chapterList = useMemo(() => (data === null ? [] : chapters(data.parsed)), [data]);
  const readingIndex = Math.max(position, furthest);
  const isFinished = data?.progress?.finished ?? (data?.progress?.percent ?? 0) >= FINISHED_PERCENT;
  const summaryIndex = data !== null && isFinished ? data.parsed.blocks.length : readingIndex;
  const cover = useMemo(
    () =>
      data === null
        ? { target: 0, current: null }
        : coverage(chapterList, data.parsed, kind, summaryIndex),
    [data, chapterList, kind, summaryIndex],
  );
  const readingCover = useMemo(
    () =>
      data === null
        ? { target: 0, current: null }
        : coverage(chapterList, data.parsed, kind, readingIndex),
    [data, chapterList, kind, readingIndex],
  );
  const summaryInput = useMemo<SummaryInput | null>(
    () =>
      data === null ? null : { meta: data.meta, parsed: data.parsed, kind, index: summaryIndex },
    [data, kind, summaryIndex],
  );
  const autoSummaryInput = useMemo<SummaryInput | null>(
    () => (summaryInput === null ? null : { ...summaryInput, index: readingIndex }),
    [summaryInput, readingIndex],
  );
  const lines = useMemo(() => {
    const map = new Map<number, string>();

    if (ai === null || !ai.linesInContents || summary === null) return map;

    chapterList.forEach((chapter, index) => {
      if (index >= cover.target) return;

      const stored = summary.chapters[index];

      // A re-parse can change the chapters. A line shows only under the heading it was made for.
      if (stored !== undefined && stored.heading === chapter.heading) {
        map.set(chapter.start, stored.line);
      }
    });

    return map;
  }, [ai, summary, chapterList, cover.target]);

  return {
    chapterList,
    readingIndex,
    isFinished,
    cover,
    readingCover,
    summaryInput,
    autoSummaryInput,
    lines,
  };
}

export function useReaderMode({
  data,
  isEpub,
  prefs,
  guessed,
}: {
  readonly data: LoadedBook | null;
  readonly isEpub: boolean;
  readonly prefs: Partial<BookPrefs>;
  readonly guessed: ReturnType<typeof guessMode>;
}): {
  readonly mode: ReaderMode;
  readonly showsPages: boolean;
  readonly pendingBooks: ReadonlyArray<BookMeta>;
  readonly startPage: number;
} {
  const mode: ReaderMode = isEpub ? "reader" : (prefs.mode ?? guessed);
  // Figures only show in the reader view, so the job pauses while the original pages show.
  const showsPages = mode === "original" || data?.meta.parseState === "scanned";
  const pendingBooks = useMemo(
    () => (data === null || showsPages ? [] : [data.meta]),
    [data, showsPages],
  );
  // The figure job starts at the page being read, so its figures land first.
  const startPage = data?.parsed.blocks[data.progress?.blockIndex ?? 0]?.page ?? 1;

  return { mode, showsPages, pendingBooks, startPage };
}

export function describePageLabels(
  data: LoadedBook | null,
  glance: { readonly meta: BookMeta; readonly progress: ReadingProgress | null } | undefined,
  position: number,
  formatPercent: (ratio: number) => string,
): {
  readonly title: string;
  readonly toc: ReadonlyArray<TocEntry>;
  readonly total: number;
  readonly shown: number;
  readonly percentLabel: string;
} {
  const title = data?.meta.title ?? glance?.meta.title ?? "Reader";
  const toc = data?.parsed.toc ?? [];
  const total = data === null ? 1 : Math.max(1, data.parsed.blocks.length - 1);
  const shown = data === null ? (glance?.progress?.percent ?? 0) : position;

  return { title, toc, total, shown, percentLabel: formatPercent(shown / total) };
}
