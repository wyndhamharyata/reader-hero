import { Effect, Stream } from "effect";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { ArrowRightIcon, ClipboardIcon, XMarkIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";
import { CONSENT_VERSION, type AiSettings, type Summary } from "@/domain/ai";
import type { ReaderSettings } from "@/domain/book";
import { formatPercent } from "@/lib/format";
import { forkApp, stopFiber, useAppEffect } from "@/lib/hooks";
import type { Shelf } from "@/lib/shelf";
import { holdLowestRow } from "@/lib/hold-lowest-row";
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
  // The book's text settings: on desktop the sheet takes the reader's line width, as the Summary does.
  reading: ReaderSettings;
  state: JobState;
  onStart: () => void;
  onStop: () => void;
  onConsent: () => void;
  onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [consentPending, setConsentPending] = useState(false);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, Summary | null>>(new Map());
  // A desktop has the room, so the paragraphs up to the current book stay open there.
  const [desktop] = useState(() => window.matchMedia("(width >= 48rem)").matches);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Read again only when the order or a status changes, not for each reload of the same series.
  const { state: scopeState } = useAppEffect(seriesScope(series, bookId), [
    bookId,
    series.books.map((card) => `${card.book.id} ${card.status}`).join("\n"),
  ]);
  const volumes = scopeState.status === "done" ? scopeState.value : null;

  // The stored summaries follow every write, so the run's chapters and paragraph show as they land.
  useEffect(() => {
    if (volumes === null) return;
    const fiber = forkApp(
      Effect.flatMap(SummaryStore, (store) =>
        Effect.forEach(
          volumes.map((volume) => volume.card.book.id),
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

  const loaded = volumes !== null && volumes.every((volume) => summaries.has(volume.card.book.id));
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
        className="relative z-10 mx-auto flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full max-w-xl flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-auto md:max-w-[calc(100%-2rem)] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="shrink-0 truncate text-xs font-medium tracking-wide uppercase opacity-60">
          Series · {series.name}
        </p>

        {/* The width is in the reader's font and size, so it matches the Summary; the rows keep the app's font. */}
        <ul
          ref={listRef}
          className="-mx-4 mt-2 min-h-0 overflow-y-auto overscroll-contain py-1 md:w-(--text-width)"
          data-font={reading.font}
          style={
            {
              fontSize: `${reading.fontSize}px`,
              "--text-width": `${reading.textWidth}ch`,
            } as CSSProperties
          }
        >
          {cards.map((card, index) => {
            const current = card.book.id === bookId;
            const row = rows[index];
            const paragraph = row?.text ?? null;
            // On desktop a later book's summary waits for a tap, so the books before it read first.
            const fixed = desktop && volumes?.[index]?.order !== "later";
            const open = fixed || expanded.has(card.book.id);
            // Any summary counts, also one that stops before the position.
            const summary = summaries.get(card.book.id) ?? null;
            const summarised =
              summary !== null &&
              (summary.chapters.length > 0 ||
                summary.current !== undefined ||
                summary.volume !== undefined);
            const line = (
              <>
                {/* The number column is as wide as the longest number, so every title starts at one edge. */}
                <span className="flex items-center gap-3">
                  <span
                    className="shrink-0 tabular-nums opacity-60"
                    style={{ width: `${String(cards.length).length}ch` }}
                  >
                    {index + 1}
                  </span>
                  {/* Clipped at the start, as in the library, so "Vol. 3" stays in view. */}
                  <span className="min-w-0 flex-1 truncate text-left font-medium [direction:rtl]">
                    <bdi dir="ltr">{card.book.title}</bdi>
                  </span>
                </span>
                <span
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  style={{ paddingLeft: `calc(${String(cards.length).length}ch + 0.75rem)` }}
                >
                  <span className={card.badge.className}>{card.badge.label}</span>
                  {summarised ? (
                    <span className="badge badge-sm badge-neutral">Summarised</span>
                  ) : (
                    <span className="badge badge-ghost badge-sm">Not summarised</span>
                  )}
                  <span className="opacity-60">
                    {[formatPercent(card.percent), row?.scope ?? null]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
              </>
            );
            const rowClass = `flex min-w-0 flex-1 flex-col gap-1 rounded-field px-2 py-2 text-left ${current ? "bg-base-300" : ""} ${text}`;
            return (
              <li key={card.book.id} className="px-2 font-sans">
                <div className="flex items-center gap-1">
                  {paragraph === null || fixed ? (
                    <div data-row aria-current={current ? "true" : undefined} className={rowClass}>
                      {line}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`${rowClass} hover:bg-base-300`}
                      data-row
                      aria-current={current ? "true" : undefined}
                      aria-expanded={open}
                      onClick={(event) => {
                        if (listRef.current !== null)
                          holdLowestRow(listRef.current, event.currentTarget);
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (open) next.delete(card.book.id);
                          else next.add(card.book.id);
                          return next;
                        });
                      }}
                    >
                      {line}
                    </button>
                  )}
                  {!current && (
                    <SlideLink
                      to={`/book/${card.book.id}`}
                      direction="in"
                      className={`${button} btn-square shrink-0 btn-ghost`}
                      aria-label="Open book"
                      title="Open book"
                    >
                      <ArrowRightIcon className="size-5 opacity-60 md:size-4" />
                    </SlideLink>
                  )}
                </div>
                {/* Rows animate between 0fr and 1fr, as Text settings in the menu does. */}
                {paragraph !== null && (
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                    inert={!open}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className={`px-2 pb-3 whitespace-pre-wrap ${text}`}>{paragraph}</p>
                    </div>
                  </div>
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
