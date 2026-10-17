import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  AiProvider,
  AiSettings,
  CONSENT_VERSION,
  hasConsent,
  providerLabels,
  relayedProviders,
} from "@/domain/ai";
import type { ModelInfo } from "@/lib/ai-transport";
import { runApp, useAiSettings, useJob, useSettings, useUsage } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { ConsentNote } from "@/components/ConsentNote";
import { AiClient } from "@/services/ai-client";
import { GeneralSettings } from "./_GeneralSettings";
import { ModelPicker } from "./_ModelPicker";
import { UsagePanel } from "./_UsagePanel";
import { settingsHeading } from "./_settings-shared";
import type { Grouping } from "./_use-series-grouping";
import { ProviderPicker } from "./_ProviderPicker";

interface Props {
  isOpen: boolean;
  // The library's grouping run: books left while it runs, then the totals, or its error.
  grouping: Grouping;
  onRetry: () => void;
  onReset: () => void;
  onLicences: () => void;
  onClose: () => void;
}

// Where a reader makes a key, so the sheet points the way instead of sending them to search.
const keyPages: Partial<Record<AiProvider, string>> = {
  deepseek: "https://platform.deepseek.com/api_keys",
  openrouter: "https://openrouter.ai/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
  cerebras: "https://cloud.cerebras.ai/",
  zai: "https://z.ai/manage-apikey/apikey-list",
  opencode: "https://opencode.ai/console/go",
  opencodeConsole: "https://opencode.ai/console",
  nvidia: "https://build.nvidia.com/settings/api-keys",
  mistral: "https://console.mistral.ai/api-keys",
  together: "https://api.together.ai/settings/api-keys",
};

type Test =
  | { readonly state: "idle" }
  | { readonly state: "testing" }
  | { readonly state: "valid"; readonly balance: string | null }
  | { readonly state: "failed"; readonly message: string };

export function SettingsSheet({
  isOpen,
  grouping,
  onRetry,
  onReset,
  onLicences,
  onClose,
}: Props): ReactElement | null {
  const { ai, putAi } = useAiSettings();
  const { settings, update } = useSettings();
  const [tab, setTab] = useState<"general" | "provider">("general");
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const { dismiss } = useBottomSheet(isOpen, sheetRef, backdropRef, onClose);

  useTabSwipe(viewport, track, ["general", "provider"] as const, tab, setTab);

  const [provider, setProvider] = useState<AiProvider>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  // The provider to go back to on Cancel.
  const [relayNotice, setRelayNotice] = useState<AiProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [linesInContents, setLinesInContents] = useState(true);
  const [autoSummary, setAutoSummary] = useState(false);
  const [seriesGrouping, setSeriesGrouping] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  // The action whose consent note shows, under its own control.
  const [consentFor, setConsentFor] = useState<"grouping" | "rebuild" | null>(null);
  const consentNote = useRef<HTMLDivElement>(null);
  const rebuild = useJob("rebuild");
  const usage = useUsage();
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  // The model list's filter while it is open. The chevron opens it with none, so every model shows.
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ state: "idle" });

  // Reset on open, so a cancelled edit stores nothing. A toggle's save keeps the Provider fields.
  useEffect(() => {
    if (!isOpen) return;

    setProvider(ai?.provider ?? "deepseek");
    setApiKey(ai?.apiKey ?? "");
    setModel(ai?.model ?? "");
    setBaseUrl(ai?.baseUrl ?? "");
    setRelayNotice(null);
    setConsentPending(false);
    setConsentFor(null);
    setModels([]);
    setModelFilter(null);
    setTest({ state: "idle" });
  }, [isOpen, ai?.provider, ai?.apiKey, ai?.model, ai?.baseUrl]);
  useEffect(() => {
    if (!isOpen) return;

    setLinesInContents(ai?.linesInContents ?? true);
    setAutoSummary(ai?.autoSummary ?? false);
    setSeriesGrouping(ai?.seriesGrouping ?? false);
  }, [isOpen, ai]);

  // The note ends below the fold on a phone, so Allow comes into view with it.
  useEffect(() => {
    if (consentFor !== null)
      consentNote.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [consentFor]);

  if (!isOpen) return null;

  const draft = (consentedAt?: number, consentVersion?: number): AiSettings =>
    new AiSettings({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      // With no list to ask, the stored answer stands.
      reasoningOff:
        models.length === 0
          ? ai?.reasoningOff
          : models.find((entry) => entry.id === model.trim())?.reasoningOff,
      baseUrl: provider === "compatible" ? baseUrl.trim() : undefined,
      consentedAt,
      consentVersion,
      linesInContents,
      autoSummary,
      seriesGrouping,
    });

  const testKey = (): void => {
    setTest({ state: "testing" });

    const program = Effect.gen(function* () {
      const client = yield* AiClient;
      const settings = draft();
      const list = yield* client.models(settings);
      const balance = yield* client.balance(settings).pipe(Effect.orElseSucceed(() => null));

      return { list, balance };
    });

    void runApp(
      program.pipe(
        Effect.match({
          onSuccess: ({ list, balance }) => {
            setModels(list);

            // A filled field is kept as typed, so a model the provider's list omits stays through the test.
            if (list.length > 0 && model.trim() === "") {
              setModel(list[0]?.id ?? "");
            }

            setTest({ state: "valid", balance });
          },
          onFailure: (error) =>
            setTest({
              state: "failed",
              message: error.reason === "unauthorized" ? "Key rejected" : error.message,
            }),
        }),
      ),
    );
  };

  // A toggle saves at once, from the sheet's own values, so two quick taps both land.
  const saveToggles = (
    patch: { linesInContents?: boolean; autoSummary?: boolean; seriesGrouping?: boolean },
    consentedAt?: number,
  ): void => {
    if (ai === null) return;

    const next = { linesInContents, autoSummary, seriesGrouping, ...patch };

    setLinesInContents(next.linesInContents);
    setAutoSummary(next.autoSummary);
    setSeriesGrouping(next.seriesGrouping);
    putAi(
      new AiSettings({
        ...ai,
        ...next,
        ...(consentedAt === undefined ? {} : { consentedAt, consentVersion: CONSENT_VERSION }),
      }),
    );
  };

  const save = (): void => {
    // Consent is per provider, so a new provider asks again on the first action.
    const same =
      provider === ai?.provider && (provider !== "compatible" || baseUrl.trim() === ai.baseUrl);

    // Series grouping sends with no tap, so the note for the current text shows before it goes on.
    if (seriesGrouping && !(same && hasConsent(ai))) {
      setConsentPending(true);
      return;
    }

    putAi(draft(same ? ai?.consentedAt : undefined, same ? ai?.consentVersion : undefined));
    dismiss();
  };

  const removeKey = (): void => {
    putAi(null);
    dismiss();
  };

  const relayReady = provider !== "compatible" || baseUrl.trim().startsWith("https://");
  const ready = apiKey.trim() !== "" && model.trim() !== "" && relayReady;
  // The form's provider and model, so picking another model shows its own numbers.
  const usageKey = `${provider}/${model.trim()}`;
  const tally = usage.tallies.get(usageKey);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <SheetBackdrop reference={backdropRef} label="Close settings" onClose={() => dismiss()} />
      <aside
        ref={sheetRef}
        role="dialog"
        data-theme={settings.theme}
        aria-label="Settings"
        className="relative z-10 flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-[28rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <h2 className="text-lg font-semibold">Settings</h2>

        <div role="tablist" className="tabs tabs-border mt-1 tabs-lg md:tabs-md">
          {(["general", "provider"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className={`tab ${tab === value ? "tab-active" : ""}`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "general" ? "General" : "Provider"}
            </button>
          ))}
        </div>

        {/* Side by side, so the sheet keeps the taller tab's height; pan-y leaves sideways to the swipe. */}
        <div
          ref={viewport}
          className="-mx-4 mt-3 min-h-0 flex-1 [touch-action:pan-y] overflow-hidden"
        >
          <div
            ref={track}
            className="flex h-full ease-out will-change-transform motion-safe:transition-transform motion-safe:duration-200"
            style={{ transform: `translateX(${tab === "general" ? 0 : -100}%)` }}
          >
            <div
              className="h-full w-full shrink-0 overflow-y-auto overscroll-contain"
              inert={tab !== "general"}
            >
              <GeneralSettings
                ai={ai}
                settings={settings}
                onSettingsChange={update}
                isSummaryLines={linesInContents}
                isAutoSummary={autoSummary}
                isSeriesGrouping={seriesGrouping}
                onToggle={saveToggles}
                rebuild={rebuild}
                consentFor={consentFor}
                onConsentFor={setConsentFor}
                consentNote={consentNote}
                grouping={grouping}
                onRetry={onRetry}
                onReset={onReset}
                onLicences={onLicences}
                putAi={putAi}
              />
            </div>
            <div className="flex h-full w-full shrink-0 flex-col" inert={tab !== "provider"}>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <section className="px-4 pt-1">
                  <p className={settingsHeading}>Provider</p>
                  <ProviderPicker
                    value={provider}
                    onChange={(next) => {
                      if (relayedProviders.has(next) && !relayedProviders.has(provider))
                        setRelayNotice(provider);

                      setProvider(next);
                      // Another provider's model id means nothing here, so Test fills the field afresh.
                      setModel(next === ai?.provider ? ai.model : "");
                      // Test must not send this key to another provider.
                      setApiKey(next === ai?.provider ? ai.apiKey : "");
                      setModels([]);
                      setTest({ state: "idle" });
                    }}
                  />
                </section>

                {provider === "compatible" && (
                  <section className="mt-4 px-4">
                    <p className={settingsHeading}>Base URL</p>
                    <input
                      type="url"
                      className="input w-full text-base md:text-sm"
                      autoComplete="off"
                      aria-label="Base URL"
                      placeholder="https://api.groq.com/openai/v1"
                      value={baseUrl}
                      onChange={(event) => {
                        setBaseUrl(event.target.value);
                        setModels([]);
                        setTest({ state: "idle" });
                      }}
                    />
                    <p className="mt-2 text-sm opacity-60 md:text-xs">
                      The relay reaches Groq, Cerebras, Z.ai, OpenCode, NVIDIA, Cloudflare, Mistral
                      and Together.
                    </p>
                  </section>
                )}

                <section className="mt-4 px-4">
                  <p className={settingsHeading}>API key</p>
                  <div className="flex gap-2">
                    {/* 16px text on phones: iOS zooms the page into any focused input smaller than that. */}
                    <input
                      type="password"
                      className="input w-full text-base md:text-sm"
                      autoComplete="off"
                      aria-label="API key"
                      placeholder="Paste your key"
                      value={apiKey}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setTest({ state: "idle" });
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={apiKey.trim() === "" || test.state === "testing" || !relayReady}
                      onClick={testKey}
                    >
                      Test
                    </button>
                  </div>
                  <p className="mt-1 min-h-5 text-sm opacity-70 md:text-xs">
                    {test.state === "testing" && "Testing"}
                    {test.state === "valid" &&
                      (test.balance === null ? "Valid" : `Valid · balance ${test.balance}`)}
                    {test.state === "failed" && <span className="text-error">{test.message}</span>}
                  </p>
                  {keyPages[provider] !== undefined && (
                    <p className="text-sm opacity-60 md:text-xs">
                      No key yet?{" "}
                      <a
                        className="link"
                        href={keyPages[provider]}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Get one from {providerLabels[provider]}
                      </a>
                    </p>
                  )}
                </section>

                <ModelPicker
                  model={model}
                  models={models}
                  filter={modelFilter}
                  onModelChange={setModel}
                  onFilterChange={setModelFilter}
                />

                <UsagePanel tally={tally} onReset={() => usage.reset(usageKey)} />
              </div>

              {consentPending ? (
                <div className="px-4">
                  <ConsentNote
                    provider={provider}
                    onCancel={() => setConsentPending(false)}
                    onAllow={() => {
                      putAi(draft(Date.now(), CONSENT_VERSION));
                      dismiss();
                    }}
                  />
                </div>
              ) : (
                <div className="mt-3 flex gap-2 px-4">
                  <button
                    type="button"
                    className="btn btn-ghost text-error"
                    disabled={ai === null}
                    onClick={removeKey}
                  >
                    Remove key
                  </button>
                  <button
                    type="button"
                    className="btn flex-1 btn-primary"
                    disabled={!ready}
                    onClick={save}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {relayNotice !== null && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
            <div className="absolute inset-0 rounded-[inherit] bg-(--backdrop)" />
            <div
              role="alertdialog"
              aria-label="Requests go through the relay"
              className="relative w-full max-w-sm rounded-box bg-base-100 p-4 shadow-xl"
            >
              <p className="text-base font-medium md:text-sm">Requests go through our relay</p>
              <p className="mt-2 text-base md:text-sm">
                These providers do not accept requests from a web page. So Reader Hero sends them
                through its own Cloudflare Worker. The Worker passes each request to the provider
                and streams the answer back.
              </p>
              <p className="mt-2 text-base md:text-sm">
                The relay keeps nothing. Its code does not log, store or read your key or your
                book's text. You can check the code:{" "}
                <a
                  className="link"
                  href="https://github.com/wyndhamharyata/reader-hero/blob/main/src/worker/relay.ts"
                  target="_blank"
                  rel="noreferrer"
                >
                  src/worker/relay.ts
                </a>
                .
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost md:btn-sm"
                  onClick={() => {
                    setProvider(relayNotice);
                    setModel(relayNotice === ai?.provider ? ai.model : "");
                    setApiKey(relayNotice === ai?.provider ? ai.apiKey : "");
                    setRelayNotice(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary md:btn-sm"
                  onClick={() => setRelayNotice(null)}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
