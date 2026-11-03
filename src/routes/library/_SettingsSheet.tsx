import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ConsentNote } from "@/components/ConsentNote";
import { Panel } from "@/components/Panel";
import { ProviderForm } from "@/components/ProviderForm";
import { Switch } from "@/components/Switch";
import { ThemeControls } from "@/components/ThemeControls";
import { AiSettings, CONSENT_VERSION, hasConsent, providerLabels } from "@/domain/ai";
import { formatSize } from "@/lib/format";
import { runApp, useAiSettings, useJob, useSettings } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import type { StorageEstimate } from "@/services/book-store";
import { rebuildCost } from "@/use-cases/summary";
import { GroupingStatus } from "./_GroupingStatus";
import type { Grouping } from "./_use-series-grouping";

type Toggles = {
  readonly linesInContents: boolean;
  readonly autoSummary: boolean;
  readonly seriesGrouping: boolean;
};

type RebuildStep =
  | { readonly step: "idle" }
  | { readonly step: "counting" }
  | { readonly step: "confirm"; readonly books: number; readonly requests: number }
  | { readonly step: "consent" };

export function SettingsSheet({
  isOpen,
  estimate,
  grouping,
  onRetry,
  onReset,
  onLicences,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly estimate: StorageEstimate | null;
  // The library's grouping run: books left while it runs, then the totals, or its error.
  readonly grouping: Grouping;
  readonly onRetry: () => void;
  readonly onReset: () => void;
  readonly onLicences: () => void;
  readonly onClose: () => void;
}): ReactElement | null {
  const { ai, putAi } = useAiSettings();
  const { settings, update } = useSettings();
  const [view, setView] = useState<"main" | "provider">("main");
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(isOpen, sheetRef, backdropRef, onClose);
  // Held here, so two quick taps on two switches both count before the store answers.
  const [toggles, setToggles] = useState<Toggles>({
    linesInContents: true,
    autoSummary: false,
    seriesGrouping: false,
  });
  const [isGroupingConsent, setGroupingConsent] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setView("main");
    setGroupingConsent(false);
  }, [isOpen]);
  useEffect(() => {
    setToggles({
      linesInContents: ai?.linesInContents ?? true,
      autoSummary: ai?.autoSummary ?? false,
      seriesGrouping: ai?.seriesGrouping ?? false,
    });
  }, [ai]);

  if (!isOpen) return null;

  // A switch saves at once, from the panel's own values.
  const saveToggles = (patch: Partial<Toggles>, consentedAt?: number): void => {
    if (ai === null) return;

    const next = { ...toggles, ...patch };
    const consent =
      consentedAt === undefined ? {} : { consentedAt, consentVersion: CONSENT_VERSION };

    setToggles(next);
    putAi(new AiSettings({ ...ai, ...next, ...consent }));
  };

  if (view === "provider") {
    return (
      <Panel
        sheetRef={sheetRef}
        backdropRef={backdropRef}
        label="Provider"
        title="Provider"
        onBack={() => setView("main")}
        onDismiss={() => dismiss()}
      >
        <ProviderForm
          ai={ai}
          isSetup={false}
          onSave={(next) => {
            putAi(next);
            setView("main");
          }}
          onRemove={() => {
            putAi(null);
            setView("main");
          }}
        />
      </Panel>
    );
  }

  const providerValue = ai === null ? "None" : `${providerLabels[ai.provider]} · ${ai.model}`;

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Settings"
      title="Settings"
      onDismiss={() => dismiss()}
    >
      <h3 className="section-title">Appearance</h3>
      <ThemeControls settings={settings} onChange={update} />

      <h3 className="section-title">Summaries</h3>
      <div className="rows">
        <button type="button" className="row-item" onClick={() => setView("provider")}>
          <span className="row-label">Provider</span>
          <span className="value">{providerValue}</span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </button>
        <div className="row-item">
          <span className="row-label">Summarise automatically</span>
          <Switch
            isOn={toggles.autoSummary}
            label="Summarise automatically"
            isDisabled={ai === null}
            onChange={(isOn) => saveToggles({ autoSummary: isOn })}
          />
        </div>
        <div className="row-item">
          <span className="row-label">Summaries in Contents</span>
          <Switch
            isOn={toggles.linesInContents}
            label="Summaries in Contents"
            isDisabled={ai === null}
            onChange={(isOn) => saveToggles({ linesInContents: isOn })}
          />
        </div>
        <div className="row-item">
          <span className="row-label">Group books into series</span>
          <Switch
            isOn={settings.seriesGrouping}
            label="Group books into series"
            onChange={(isOn) => {
              // With a provider, grouping sends with no tap, so the note for the current text shows before it goes on.
              if (isOn && ai !== null && !hasConsent(ai)) {
                setGroupingConsent(true);
                return;
              }

              update({ seriesGrouping: isOn });
              saveToggles({ seriesGrouping: isOn });
              // Turned on, the groups are worked out again, so a series the reader deleted is back.
              if (isOn) onReset();
            }}
          />
        </div>
        {settings.seriesGrouping && ai !== null && (
          <GroupingStatus grouping={grouping} onRetry={onRetry} onReset={onReset} />
        )}
      </div>
      {isGroupingConsent && ai !== null && (
        <div className="mt-3">
          <ConsentNote
            provider={ai.provider}
            onCancel={() => setGroupingConsent(false)}
            onAllow={() => {
              setGroupingConsent(false);
              update({ seriesGrouping: true });
              saveToggles({ seriesGrouping: true }, Date.now());
              onReset();
            }}
          />
        </div>
      )}

      <h3 className="section-title">Storage</h3>
      <StorageRows estimate={estimate} ai={ai} putAi={putAi} />

      <h3 className="section-title">About</h3>
      <div className="rows">
        <button type="button" className="row-item" onClick={onLicences}>
          <span className="row-label">Open source licences</span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </Panel>
  );
}

// Storage, and the rebuild of every summary, which spends the reader's credits, so it names its cost first.
function StorageRows({
  estimate,
  ai,
  putAi,
}: {
  readonly estimate: StorageEstimate | null;
  readonly ai: AiSettings | null;
  readonly putAi: (next: AiSettings | null) => void;
}): ReactElement {
  const [rebuildStep, setRebuildStep] = useState<RebuildStep>({ step: "idle" });
  const rebuild = useJob("rebuild");
  const run = rebuild.run;
  const hasEstimate = estimate !== null && estimate.quota > 0;
  const usedRatio = hasEstimate ? estimate.usage / estimate.quota : 0;
  const providerName = ai === null ? "the provider" : providerLabels[ai.provider];

  const countRebuild = (): void => {
    setRebuildStep({ step: "counting" });
    void runApp(
      rebuildCost().pipe(
        Effect.match({
          onSuccess: (cost) => setRebuildStep({ step: "confirm", ...cost }),
          onFailure: () => setRebuildStep({ step: "idle" }),
        }),
      ),
    );
  };

  const startRebuild = (): void => {
    if (ai === null) return;
    // Only the current consent text names what a series paragraph and a later volume's list send.
    if (!hasConsent(ai)) {
      setRebuildStep({ step: "consent" });
      return;
    }

    setRebuildStep({ step: "idle" });
    rebuild.startRebuild(ai);
  };

  return (
    <>
      <div className="rows">
        {hasEstimate && (
          <div className="row-item">
            <span className="row-label flex-none">
              {formatSize(estimate.usage)} of {formatSize(estimate.quota)}
            </span>
            <span className="meter h-2.5 flex-1">
              <span style={{ width: `max(8px, ${usedRatio * 100}%)` }} />
            </span>
          </div>
        )}
        {run !== null && (
          <div className="row-item">
            <span className="row-label flex-none">Summaries</span>
            <span className="meter stripes flex-1">
              <span style={{ width: `${(run.chapter / Math.max(1, run.of)) * 100}%` }} />
            </span>
            <span className="value">
              {run.of === 0 ? "Starting" : `${run.chapter} of ${run.of}`}
            </span>
            <button type="button" className="key small" onClick={rebuild.stop}>
              Stop
            </button>
          </div>
        )}
        {run === null && rebuildStep.step === "confirm" && (
          <div className="row-item flex-wrap">
            <span className="row-label basis-full">
              Rebuild {rebuildStep.books} {rebuildStep.books === 1 ? "summary" : "summaries"}? About{" "}
              {rebuildStep.requests} requests to {providerName}.
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="key small"
                onClick={() => setRebuildStep({ step: "idle" })}
              >
                Cancel
              </button>
              <button type="button" className="key small green" onClick={startRebuild}>
                Rebuild
              </button>
            </div>
          </div>
        )}
        {run === null && rebuildStep.step !== "confirm" && (
          <div className="row-item">
            <span className="row-label">All summaries</span>
            <button
              type="button"
              className="key small"
              disabled={ai === null || rebuildStep.step === "counting"}
              onClick={countRebuild}
            >
              Rebuild
            </button>
          </div>
        )}
        {rebuild.error !== null && (
          <div className="row-item">
            <span className="row-label text-(--red)">{rebuild.error}</span>
          </div>
        )}
      </div>
      {rebuildStep.step === "consent" && ai !== null && (
        <div className="mt-3">
          <ConsentNote
            provider={ai.provider}
            onCancel={() => setRebuildStep({ step: "idle" })}
            onAllow={() => {
              const next = new AiSettings({
                ...ai,
                consentedAt: Date.now(),
                consentVersion: CONSENT_VERSION,
              });

              setRebuildStep({ step: "idle" });
              putAi(next);
              rebuild.startRebuild(next);
            }}
          />
        </div>
      )}
    </>
  );
}
