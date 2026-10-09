import { Effect, Stream } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { BookOpenIcon, ClipboardIcon, XMarkIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";
import { CONSENT_VERSION, type AiSettings, type Summary } from "@/domain/ai";
import type { ReaderSettings } from "@/domain/book";
import { forkApp, stopFiber, useAppEffect } from "@/lib/hooks";
import type { Shelf } from "@/lib/shelf";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import type { JobState } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";
import { describeSeries, seriesScope } from "@/use-cases/summary";
import { ConsentNote } from "./_ConsentNote";

const text = "text-base md:text-sm";
const button = "btn md:btn-sm";

// Another book opens over this one, so Back in it returns here; closing the sheet leaves the run going.
export function SeriesSheet({
  series,
  bookId,
  settings,
  reading,
  state,
  onStart,
  onStop,
  onConsent,
  onClose,
}: {
  series: Shelf["series"][number];
  bookId: string;
  // Null with no provider: the stored paragraphs still read, and nothing runs.
  settings: AiSettings | null;
  // The book's text settings: a paragraph is reading text and takes their size, font and leading.
  reading: ReaderSettings;
  state: JobState;
  onStart: () => void;
  onStop: () => void;
  onConsent: () => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [consentPending, setConsentPending] = useState(false);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, Summary | null>>(new Map());
  // Read again only when the order or a status changes, not for each reload of the same series.
  const { state: scopeState } = useAppEffect(seriesScope(series, bookId), [
    bookId,
    series.books.map((card) => `${card.book.id} ${card.status}`).join("\n"),
  ]);
  const volumes = scopeState.status === "done" ? scopeState.value : null;

  // The stored paragraphs follow every write, so the run's chapters and paragraph show as they land.
  useEffect(() => {
    if (volumes === null) return;
    const fiber = forkApp(
      Effect.flatMap(SummaryStore, (store) =>
        Effect.forEach(
          volumes.flatMap((volume) => (volume.scope === null ? [] : [volume.card.book.id])),
          (id) =>
            Stream.fromEffect(
              store.get(id).pipe(Effect.catchTag("StorageFailure", () => Effect.succeed(null))),
            ).pipe(
              Stream.concat(store.changes(id)),
              Stream.runForEach((next) =>
                Effect.sync(() => setSummaries((current) => new Map(current).set(id, next))),
              ),
            ),
          { concurrency: "unbounded", discard: true },
        ),
      ),
    );
    return () => stopFiber(fiber);
  }, [volumes]);

  const loaded =
    volumes !== null &&
    volumes.every((volume) => volume.scope === null || summaries.has(volume.card.book.id));
  const { rows, action, status } = loaded
    ? describeSeries(volumes, summaries, state.run)
    : { rows: [], action: null, status: null };
  // The rows follow the order that was read, so a scope line never lands on another book.
  const cards = volumes?.map((volume) => volume.card) ?? series.books;

  const start = (): void => {
    if (settings === null) return;
    if (settings.consentedAt === undefined || settings.consentVersion !== CONSENT_VERSION) {
      setConsentPending(true);
      return;
    }
    onStart();
  };

  const copy = (): void => {
    const copied = cards.flatMap((card, index) => {
      const paragraph = rows[index]?.text ?? null;
      return paragraph === null ? [] : [`${card.book.title}\n${paragraph}`];
    });
    void navigator.clipboard.writeText(copied.join("\n\n"));
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Series"
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-[32rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="shrink-0 truncate text-xs font-medium tracking-wide uppercase opacity-60">
          Series · {series.name}
        </p>

        <ul className="-mx-4 mt-2 min-h-0 overflow-y-auto overscroll-contain py-1">
          {cards.map((card, index) => {
            const current = card.book.id === bookId;
            const row = rows[index];
            // The status line runs under the open icon too, so a badge and its scope fit one line on a phone.
            const line = (
              <>
                <span className="flex items-center gap-2">
                  <span className="w-8 shrink-0 tabular-nums opacity-60">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{card.book.title}</span>
                  {!current && <BookOpenIcon className="size-5 shrink-0 opacity-60 md:size-4" />}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-10">
                  <span className={card.badge.className}>{card.badge.label}</span>
                  {row !== undefined && <span className="opacity-60">{row.scope}</span>}
                </span>
              </>
            );
            return (
              <li key={card.book.id} className="px-2">
                {current ? (
                  <div
                    aria-current="true"
                    className={`flex flex-col gap-1 rounded-field px-2 py-2 ${text}`}
                  >
                    {line}
                  </div>
                ) : (
                  <SlideLink
                    to={`/book/${card.book.id}`}
                    direction="in"
                    className={`flex flex-col gap-1 rounded-field px-2 py-2 hover:bg-base-300 ${text}`}
                  >
                    {line}
                  </SlideLink>
                )}
                {row !== undefined && row.text !== null && (
                  <p
                    className="pr-2 pb-2 pl-12 whitespace-pre-wrap"
                    data-font={reading.font}
                    style={{ fontSize: `${reading.fontSize}px`, lineHeight: reading.lineHeight }}
                  >
                    {row.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {consentPending && settings !== null ? (
          // The list gives way, so Allow stays on screen under the long note.
          <div className="shrink-0">
            <ConsentNote
              provider={settings.provider}
              onCancel={() => setConsentPending(false)}
              onAllow={() => {
                setConsentPending(false);
                onConsent();
                onStart();
              }}
            />
          </div>
        ) : (
          <>
            {state.error !== null && (
              <p className={`mt-2 flex items-center gap-3 text-error ${text}`}>
                {state.error}
                <button type="button" className={`${button} btn-ghost`} onClick={start}>
                  Retry
                </button>
              </p>
            )}
            {settings === null ? (
              <p className={`mt-3 opacity-70 ${text}`}>No provider · set in Library Settings</p>
            ) : state.run !== null ? (
              <div className={`mt-3 flex items-center justify-between gap-3 ${text}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="loading loading-sm shrink-0 loading-spinner md:loading-xs" />
                  <span className="truncate">{status}</span>
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

            <div className="mt-2 flex items-center gap-2">
              <span className="flex-1" />
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Copy"
                title="Copy"
                disabled={!rows.some((entry) => entry.text !== null)}
                onClick={copy}
              >
                <ClipboardIcon className="size-6 md:size-4" />
              </button>
              <button
                type="button"
                className={`${button} btn-square btn-ghost`}
                aria-label="Close"
                title="Close"
                onClick={() => dismiss()}
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
