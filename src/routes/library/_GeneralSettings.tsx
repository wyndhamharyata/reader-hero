import type { ReactElement, RefObject } from "react";
import { ThemeControls } from "@/components/ThemeControls";
import { AiSettings, CONSENT_VERSION, hasConsent } from "@/domain/ai";
import type { ReaderSettings } from "@/domain/book";
import type { useJob } from "@/lib/hooks";
import { ConsentNote } from "@/routes/reader/_ConsentNote";
import { settingsHeading, type GroupingState } from "./_settings-shared";

export function GeneralSettings({
  ai,
  settings,
  onSettingsChange,
  isSummaryLines,
  isAutoSummary,
  isSeriesGrouping,
  onToggle,
  rebuild,
  consentFor,
  onConsentFor,
  consentNote,
  grouping,
  onRetry,
  onReset,
  onLicences,
  putAi,
}: {
  readonly ai: AiSettings | null;
  readonly settings: ReaderSettings;
  readonly onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  readonly isSummaryLines: boolean;
  readonly isAutoSummary: boolean;
  readonly isSeriesGrouping: boolean;
  readonly onToggle: (
    patch: { linesInContents?: boolean; autoSummary?: boolean; seriesGrouping?: boolean },
    consentedAt?: number,
  ) => void;
  readonly rebuild: ReturnType<typeof useJob>;
  readonly consentFor: "grouping" | "rebuild" | null;
  readonly onConsentFor: (value: "grouping" | "rebuild" | null) => void;
  readonly consentNote: RefObject<HTMLDivElement | null>;
  readonly grouping: GroupingState;
  readonly onRetry: () => void;
  readonly onReset: () => void;
  readonly onLicences: () => void;
  readonly putAi: (next: AiSettings | null) => void;
}): ReactElement {
  return (
    <>
      <div className="mx-4 mb-1 rounded-box bg-base-300 p-3">
        <ThemeControls settings={settings} onChange={onSettingsChange} />
      </div>
      {ai === null && (
        <p className="mx-4 mt-4 text-sm opacity-60 md:text-xs">
          Summary and Series grouping need a provider and key, set in Provider.
        </p>
      )}
      <section className="mt-4 px-4">
        <p className={settingsHeading}>Summary</p>
        <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
          <span>Summaries in Contents</span>
          <input
            type="checkbox"
            className="toggle md:toggle-sm"
            checked={isSummaryLines}
            disabled={ai === null}
            onChange={(event) => onToggle({ linesInContents: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
          <span>Automatic summary</span>
          <input
            type="checkbox"
            className="toggle md:toggle-sm"
            checked={isAutoSummary}
            disabled={ai === null}
            onChange={(event) => onToggle({ autoSummary: event.target.checked })}
          />
        </label>
        <p className="text-sm opacity-60 md:text-xs">
          Automatic summary sends each chapter when it is read. In a series, it then writes the
          book's series paragraph again, and the paragraph of each earlier volume that has none.
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 py-1 text-base md:text-sm">
          <span>All summaries</span>
          {rebuild.run === null ? (
            <button
              type="button"
              className="btn btn-ghost md:btn-sm"
              disabled={ai === null}
              onClick={() => {
                if (ai === null) return;
                // Only the current consent text names what a series paragraph and a later volume's list send.
                if (!hasConsent(ai)) {
                  onConsentFor("rebuild");
                  return;
                }

                rebuild.startRebuild(ai);
              }}
            >
              Rebuild
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="loading loading-sm loading-spinner md:loading-xs" />
              {rebuild.run.of === 0
                ? "Starting"
                : `${rebuild.run.of - rebuild.run.chapter + 1} ${rebuild.run.of - rebuild.run.chapter === 0 ? "book" : "books"} left`}
              <button type="button" className="btn btn-ghost md:btn-sm" onClick={rebuild.stop}>
                Stop
              </button>
            </span>
          )}
        </div>
        {consentFor === "rebuild" && ai !== null && (
          <div className="mb-3" ref={consentNote}>
            <ConsentNote
              provider={ai.provider}
              onCancel={() => onConsentFor(null)}
              onAllow={() => {
                onConsentFor(null);

                const next = new AiSettings({
                  ...ai,
                  consentedAt: Date.now(),
                  consentVersion: CONSENT_VERSION,
                });

                putAi(next);
                rebuild.startRebuild(next);
              }}
            />
          </div>
        )}
        {rebuild.error !== null && (
          <p className="text-base text-error md:text-sm">{rebuild.error}</p>
        )}
        <p className="text-sm opacity-60 md:text-xs">
          Rebuild writes every summary again up to where you read: the chapters, the characters and
          the series paragraph, each series first volume to last. It sends one request per chapter
          read, and stops any summary that runs. Edited characters stay; questions and answers go.
        </p>
      </section>

      <section className="mt-4 px-4 pb-1">
        <p className={settingsHeading}>Series</p>
        <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
          <span>Series grouping</span>
          <input
            type="checkbox"
            className="toggle md:toggle-sm"
            checked={isSeriesGrouping}
            disabled={ai === null}
            onChange={(event) => {
              const isOn = event.target.checked;

              // Grouping sends with no tap, so the note for the current text shows before it goes on.
              if (isOn && !hasConsent(ai)) {
                onConsentFor("grouping");
                return;
              }

              onToggle({ seriesGrouping: isOn });
            }}
          />
        </label>
        {consentFor === "grouping" && ai !== null && (
          <div className="mb-3" ref={consentNote}>
            <ConsentNote
              provider={ai.provider}
              onCancel={() => onConsentFor(null)}
              onAllow={() => {
                onConsentFor(null);
                onToggle({ seriesGrouping: true }, Date.now());
              }}
            />
          </div>
        )}
        <p className="text-sm opacity-60 md:text-xs">
          Series grouping sends the title, author, file name and first 200 words of each new book,
          and the series that exist for its author.
        </p>
        {isSeriesGrouping &&
          grouping !== null &&
          ("error" in grouping ? (
            <p className="mt-2 flex items-center gap-3 text-base text-error md:text-sm">
              {grouping.error}
              <button type="button" className="btn btn-ghost md:btn-sm" onClick={onRetry}>
                Retry
              </button>
            </p>
          ) : "left" in grouping ? (
            <p className="mt-2 flex items-center gap-2 text-base md:text-sm">
              <span className="loading loading-sm loading-spinner md:loading-xs" />
              {grouping.left} {grouping.left === 1 ? "book" : "books"} left
            </p>
          ) : (
            <>
              <p className="mt-2 flex items-center justify-between gap-3 text-base md:text-sm">
                <span className="opacity-70">
                  {grouping.books} {grouping.books === 1 ? "book" : "books"} · {grouping.series}{" "}
                  series
                </span>
                <button type="button" className="btn btn-ghost md:btn-sm" onClick={onReset}>
                  Reset
                </button>
              </p>
              <p className="text-sm opacity-60 md:text-xs">
                Reset sends every book again. Series that grouping made go, removed series come
                back, and saved series stay.
              </p>
            </>
          ))}
      </section>

      <section className="mt-4 px-4 pb-1">
        <p className={settingsHeading}>About</p>
        <button type="button" className="btn w-full btn-ghost md:btn-sm" onClick={onLicences}>
          Open source licences
        </button>
      </section>
    </>
  );
}
