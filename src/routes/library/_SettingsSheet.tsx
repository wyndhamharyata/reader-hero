import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { ThemeControls } from "@/components/ThemeControls";
import {
  AiProvider,
  AiSettings,
  CONSENT_VERSION,
  providerLabels,
  relayedProviders,
} from "@/domain/ai";
import type { ModelInfo } from "@/lib/ai-transport";
import { formatPercent } from "@/lib/format";
import { runApp, useAiSettings, useJob, useSettings, useUsage } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { ConsentNote } from "@/routes/reader/_ConsentNote";
import { AiClient } from "@/services/ai-client";
import { ProviderPicker } from "./_ProviderPicker";

interface Props {
  open: boolean;
  // The library's grouping run: books left while it runs, then the totals, or its error.
  grouping:
    | { readonly left: number }
    | { readonly books: number; readonly series: number }
    | { readonly error: string }
    | null;
  onRetry: () => void;
  onReset: () => void;
  onLicences: () => void;
  onClose: () => void;
}

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

// Where a reader makes a key, so the sheet points the way instead of leaving them to search.
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
  open,
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
  const { dismiss } = useBottomSheet(open, sheetRef, backdropRef, onClose);
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
  // The model list's filter while it is open; the chevron opens it with none, so every model shows.
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ state: "idle" });

  // Reset on open, so a cancelled edit leaves nothing; a toggle's save keeps the Provider fields.
  useEffect(() => {
    if (!open) return;
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
  }, [open, ai?.provider, ai?.apiKey, ai?.model, ai?.baseUrl]);
  useEffect(() => {
    if (!open) return;
    setLinesInContents(ai?.linesInContents ?? true);
    setAutoSummary(ai?.autoSummary ?? false);
    setSeriesGrouping(ai?.seriesGrouping ?? false);
  }, [open, ai]);

  // The note ends below the fold on a phone, so Allow comes into view with it.
  useEffect(() => {
    if (consentFor !== null)
      consentNote.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [consentFor]);

  if (!open) return null;

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
            // A filled field is kept as typed, so a model the provider's list leaves out survives the test.
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
    // Consent is per provider: a new provider asks again on the first action.
    const same =
      provider === ai?.provider && (provider !== "compatible" || baseUrl.trim() === ai.baseUrl);
    // Series grouping sends with no tap, so the note for the current text shows before it goes on.
    if (
      seriesGrouping &&
      !(same && ai?.consentedAt !== undefined && ai.consentVersion === CONSENT_VERSION)
    ) {
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
  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close settings"
        onClick={() => dismiss()}
      />
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
              <div className="mx-4 mb-1 rounded-box bg-base-300 p-3">
                <ThemeControls settings={settings} onChange={update} />
              </div>
              {ai === null && (
                <p className="mx-4 mt-4 text-sm opacity-60 md:text-xs">
                  Summary and Series grouping need a provider and key, set in Provider.
                </p>
              )}
              <section className="mt-4 px-4">
                <p className={heading}>Summary</p>
                <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
                  <span>Summaries in Contents</span>
                  <input
                    type="checkbox"
                    className="toggle md:toggle-sm"
                    checked={linesInContents}
                    disabled={ai === null}
                    onChange={(event) => saveToggles({ linesInContents: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
                  <span>Automatic summary</span>
                  <input
                    type="checkbox"
                    className="toggle md:toggle-sm"
                    checked={autoSummary}
                    disabled={ai === null}
                    onChange={(event) => saveToggles({ autoSummary: event.target.checked })}
                  />
                </label>
                <p className="text-sm opacity-60 md:text-xs">
                  Automatic summary sends each chapter when it is read. In a series, it then writes
                  the book's series paragraph again, and the paragraph of each earlier volume that
                  has none.
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
                        if (ai.consentedAt === undefined || ai.consentVersion !== CONSENT_VERSION) {
                          setConsentFor("rebuild");
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
                      <button
                        type="button"
                        className="btn btn-ghost md:btn-sm"
                        onClick={rebuild.stop}
                      >
                        Stop
                      </button>
                    </span>
                  )}
                </div>
                {consentFor === "rebuild" && ai !== null && (
                  <div className="mb-3" ref={consentNote}>
                    <ConsentNote
                      provider={ai.provider}
                      onCancel={() => setConsentFor(null)}
                      onAllow={() => {
                        setConsentFor(null);
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
                  Rebuild writes every summary again up to where you read: the chapters, the
                  characters and the series paragraph, each series first volume to last. It sends
                  one request per chapter read, and stops any summary that runs. Edited characters
                  stay; questions and answers go.
                </p>
              </section>

              <section className="mt-4 px-4 pb-1">
                <p className={heading}>Series</p>
                <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
                  <span>Series grouping</span>
                  <input
                    type="checkbox"
                    className="toggle md:toggle-sm"
                    checked={seriesGrouping}
                    disabled={ai === null}
                    onChange={(event) => {
                      const on = event.target.checked;
                      // Grouping sends with no tap, so the note for the current text shows before it goes on.
                      if (
                        on &&
                        !(ai?.consentedAt !== undefined && ai.consentVersion === CONSENT_VERSION)
                      ) {
                        setConsentFor("grouping");
                        return;
                      }
                      saveToggles({ seriesGrouping: on });
                    }}
                  />
                </label>
                {consentFor === "grouping" && ai !== null && (
                  <div className="mb-3" ref={consentNote}>
                    <ConsentNote
                      provider={ai.provider}
                      onCancel={() => setConsentFor(null)}
                      onAllow={() => {
                        setConsentFor(null);
                        saveToggles({ seriesGrouping: true }, Date.now());
                      }}
                    />
                  </div>
                )}
                <p className="text-sm opacity-60 md:text-xs">
                  Series grouping sends the title, author, file name and first 200 words of each new
                  book, and the series that exist for its author.
                </p>
                {seriesGrouping &&
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
                          {grouping.books} {grouping.books === 1 ? "book" : "books"} ·{" "}
                          {grouping.series} series
                        </span>
                        <button type="button" className="btn btn-ghost md:btn-sm" onClick={onReset}>
                          Reset
                        </button>
                      </p>
                      <p className="text-sm opacity-60 md:text-xs">
                        Reset sends every book again. Series that grouping made go, removed series
                        come back, and saved series stay.
                      </p>
                    </>
                  ))}
              </section>

              <section className="mt-4 px-4 pb-1">
                <p className={heading}>About</p>
                <button
                  type="button"
                  className="btn w-full btn-ghost md:btn-sm"
                  onClick={onLicences}
                >
                  Open source licences
                </button>
              </section>
            </div>
            <div className="flex h-full w-full shrink-0 flex-col" inert={tab !== "provider"}>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <section className="px-4 pt-1">
                  <p className={heading}>Provider</p>
                  <ProviderPicker
                    value={provider}
                    onChange={(next) => {
                      if (relayedProviders.has(next) && !relayedProviders.has(provider))
                        setRelayNotice(provider);
                      setProvider(next);
                      // Another provider's model id means nothing here, so Test fills the field afresh.
                      setModel(next === ai?.provider ? ai.model : "");
                      setModels([]);
                      setTest({ state: "idle" });
                    }}
                  />
                </section>

                {provider === "compatible" && (
                  <section className="mt-4 px-4">
                    <p className={heading}>Base URL</p>
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
                  <p className={heading}>API key</p>
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

                <section className="mt-3 px-4">
                  <p className={heading}>Model</p>
                  {/* A provider's list can leave models out, as Z.ai's does its free ones, so the field also takes a typed id. */}
                  <div className="relative">
                    <label className="input w-full pr-1 text-base md:text-sm">
                      <input
                        type="text"
                        role="combobox"
                        aria-label="Model"
                        aria-expanded={modelFilter !== null}
                        aria-controls="provider-models"
                        placeholder="Model"
                        autoComplete="off"
                        value={model}
                        onChange={(event) => {
                          setModel(event.target.value);
                          setModelFilter(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") setModelFilter("");
                          if (event.key === "Escape" && modelFilter !== null) {
                            event.stopPropagation();
                            setModelFilter(null);
                          }
                        }}
                        onBlur={() => setModelFilter(null)}
                      />
                      <button
                        type="button"
                        className="btn btn-square btn-ghost btn-sm"
                        aria-label="Show models"
                        disabled={models.length === 0}
                        // Keeps the focus in the field, so its blur does not close the list this opens.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setModelFilter(modelFilter === null ? "" : null)}
                      >
                        <ChevronDownIcon className="size-4" />
                      </button>
                    </label>
                    {modelFilter !== null && models.length > 0 && (
                      <ul
                        id="provider-models"
                        role="listbox"
                        aria-label="Models"
                        className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
                      >
                        {models
                          .filter((entry) => entry.id.includes(modelFilter.trim()))
                          .map((entry) => (
                            <li
                              key={entry.id}
                              role="option"
                              aria-selected={entry.id === model}
                              className={`cursor-pointer rounded-field px-3 py-2 text-base md:py-1.5 md:text-sm ${entry.id === model ? "bg-base-200 font-medium" : "hover:bg-base-200"}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setModel(entry.id);
                                setModelFilter(null);
                              }}
                            >
                              {entry.id}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </section>

                {tally !== undefined && tally.input > 0 && (
                  <section className="mt-4 px-4 pb-1">
                    <p className={heading}>Input cache</p>
                    <div className="flex items-center justify-between gap-3 text-base md:text-sm">
                      <span>
                        {formatPercent(tally.hit / tally.input)} from cache ·{" "}
                        {compact.format(tally.input)} input ·{" "}
                        <span className="opacity-70">
                          {tally.requests} {tally.requests === 1 ? "request" : "requests"} since{" "}
                          {new Date(tally.since).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost md:btn-sm"
                        onClick={() => usage.reset(usageKey)}
                      >
                        Reset
                      </button>
                    </div>
                    <p className="mt-2 text-sm opacity-60 md:text-xs">
                      The share of input tokens the provider read from its cache, as it reports
                      them, for the provider and model above.
                    </p>
                  </section>
                )}
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
