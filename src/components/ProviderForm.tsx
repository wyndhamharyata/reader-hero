import { Effect } from "effect";
import { useState, type ReactElement } from "react";
import { ConsentNote } from "@/components/ConsentNote";
import { ModelPicker } from "@/components/ModelPicker";
import { UsagePanel } from "@/components/UsagePanel";
import {
  AiProvider,
  AiSettings,
  CONSENT_VERSION,
  hasConsent,
  providerLabels,
  relayedProviders,
} from "@/domain/ai";
import type { ModelInfo } from "@/lib/ai-transport";
import { runApp, useSettings, useUsage } from "@/lib/hooks";
import { AiClient } from "@/services/ai-client";

// Where a reader makes a key, so the form points the way instead of sending them to search.
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

// The direct providers most readers have a key for come first. More shows the rest.
const firstProviders: ReadonlyArray<AiProvider> = [
  "anthropic",
  "openai",
  "gemini",
  "deepseek",
  "openrouter",
];
const moreProviders = AiProvider.literals.filter((id) => !firstProviders.includes(id));

type Test =
  | { readonly state: "idle" }
  | { readonly state: "testing" }
  | { readonly state: "valid"; readonly balance: string | null }
  | { readonly state: "failed"; readonly message: string };

export function ProviderForm({
  ai,
  isSetup,
  onSave,
  onRemove,
}: {
  readonly ai: AiSettings | null;
  // The first setup, in the Summary panel. The consent shows with the form, and its key agrees to it.
  readonly isSetup: boolean;
  readonly onSave: (next: AiSettings) => void;
  readonly onRemove?: () => void;
}): ReactElement {
  const [provider, setProvider] = useState<AiProvider>(() => ai?.provider ?? "anthropic");
  const [baseUrl, setBaseUrl] = useState(() => ai?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(() => ai?.apiKey ?? "");
  const [model, setModel] = useState(() => ai?.model ?? "");
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  // The model list's filter while it is open. The chevron opens it with none, so every model shows.
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [showsMore, setShowsMore] = useState(() =>
    moreProviders.includes(ai?.provider ?? "anthropic"),
  );
  // The provider to go back to on Cancel.
  const [relayNotice, setRelayNotice] = useState<AiProvider | null>(null);
  const [consentPending, setConsentPending] = useState(false);
  const usage = useUsage();
  const { settings } = useSettings();

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
      linesInContents: ai?.linesInContents ?? true,
      autoSummary: ai?.autoSummary ?? false,
      seriesGrouping: settings.seriesGrouping,
    });

  const pick = (next: AiProvider): void => {
    if (relayedProviders.has(next) && !relayedProviders.has(provider)) setRelayNotice(provider);

    setProvider(next);
    // Another provider's model id means nothing here, so Test fills the field afresh.
    setModel(next === ai?.provider ? ai.model : "");
    // Test must not send this key to another provider.
    setApiKey(next === ai?.provider ? ai.apiKey : "");
    setModels([]);
    setTest({ state: "idle" });
  };

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
            if (list.length > 0 && model.trim() === "") setModel(list[0]?.id ?? "");

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

  const save = (): void => {
    if (isSetup) {
      onSave(draft(Date.now(), CONSENT_VERSION));
      return;
    }

    // Consent is per provider, so a new provider asks again on the first action.
    const isSame =
      provider === ai?.provider && (provider !== "compatible" || baseUrl.trim() === ai.baseUrl);

    // Series grouping sends with no tap, so the note for the current text shows before it goes on.
    if (settings.seriesGrouping && !(isSame && hasConsent(ai))) {
      setConsentPending(true);
      return;
    }

    onSave(draft(isSame ? ai?.consentedAt : undefined, isSame ? ai?.consentVersion : undefined));
  };

  const isRelayReady = provider !== "compatible" || baseUrl.trim().startsWith("https://");
  const isReady = apiKey.trim() !== "" && model.trim() !== "" && isRelayReady;
  const usageKey = `${provider}/${model.trim()}`;

  return (
    <div className="flex flex-col">
      <ProviderChoices
        provider={provider}
        showsMore={showsMore}
        onPick={pick}
        onMore={() => setShowsMore(true)}
      />

      {relayNotice !== null && (
        <RelayNotice
          onCancel={() => {
            pick(relayNotice);
            setRelayNotice(null);
          }}
          onContinue={() => setRelayNotice(null)}
        />
      )}

      {provider === "compatible" && (
        <>
          <label className="field-label" htmlFor="provider-url">
            Base URL
          </label>
          <span className="field font-mono text-sm">
            <input
              id="provider-url"
              type="url"
              autoComplete="off"
              placeholder="https://api.groq.com/openai/v1"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setModels([]);
                setTest({ state: "idle" });
              }}
            />
          </span>
        </>
      )}

      <KeyField
        provider={provider}
        apiKey={apiKey}
        test={test}
        canTest={apiKey.trim() !== "" && test.state !== "testing" && isRelayReady}
        onKey={(next) => {
          setApiKey(next);
          setTest({ state: "idle" });
        }}
        onTest={testKey}
      />

      <ModelPicker
        model={model}
        models={models}
        filter={modelFilter}
        onModelChange={setModel}
        onFilterChange={setModelFilter}
      />

      {!isSetup && (
        <UsagePanel tally={usage.tallies.get(usageKey)} onReset={() => usage.reset(usageKey)} />
      )}

      {isSetup && (
        <div className="mt-5">
          <ConsentNote provider={provider} />
        </div>
      )}

      <div className="mt-5">
        {consentPending ? (
          <ConsentNote
            provider={provider}
            onCancel={() => setConsentPending(false)}
            onAllow={() => onSave(draft(Date.now(), CONSENT_VERSION))}
          />
        ) : (
          <div className="flex gap-2.5">
            {onRemove !== undefined && ai !== null && (
              <button type="button" className="key danger" onClick={onRemove}>
                Remove key
              </button>
            )}
            <button type="button" className="key green flex-1" disabled={!isReady} onClick={save}>
              {isSetup ? "Agree and summarise" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderChoices({
  provider,
  showsMore,
  onPick,
  onMore,
}: {
  readonly provider: AiProvider;
  readonly showsMore: boolean;
  readonly onPick: (provider: AiProvider) => void;
  readonly onMore: () => void;
}): ReactElement {
  const shown = showsMore ? [...firstProviders, ...moreProviders] : firstProviders;

  return (
    <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Provider">
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={id === provider}
          className="key min-h-13 px-1.5 text-[13.5px] whitespace-normal"
          onClick={() => onPick(id)}
        >
          {id === "compatible" ? "Own URL" : providerLabels[id]}
        </button>
      ))}
      {!showsMore && (
        <button type="button" className="key min-h-13 px-1.5 text-[13.5px]" onClick={onMore}>
          More
        </button>
      )}
    </div>
  );
}

function RelayNotice({
  onCancel,
  onContinue,
}: {
  readonly onCancel: () => void;
  readonly onContinue: () => void;
}): ReactElement {
  return (
    <div role="alertdialog" aria-label="Requests go through our relay" className="notice mt-4">
      <p className="font-semibold">Requests go through our relay</p>
      <p className="mt-2">
        These providers do not accept requests from a web page. So Reader Hero sends them through
        its own Cloudflare Worker. The Worker passes each request to the provider and streams the
        answer back. It does not log, store or read your key or your book's text. You can check the
        code:{" "}
        <a
          className="font-semibold text-(--green) underline"
          href="https://github.com/wyndhamharyata/reader-hero/blob/main/src/worker/relay.ts"
          target="_blank"
          rel="noreferrer"
        >
          src/worker/relay.ts
        </a>
        .
      </p>
      <div className="mt-3 flex justify-end gap-2.5">
        <button type="button" className="key small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="key small green" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}

function KeyField({
  provider,
  apiKey,
  test,
  canTest,
  onKey,
  onTest,
}: {
  readonly provider: AiProvider;
  readonly apiKey: string;
  readonly test: Test;
  readonly canTest: boolean;
  readonly onKey: (key: string) => void;
  readonly onTest: () => void;
}): ReactElement {
  const keyPage = keyPages[provider];

  return (
    <>
      <label className="field-label" htmlFor="provider-key">
        API key
      </label>
      <span className="field font-mono text-sm">
        <input
          id="provider-key"
          // Plain text: a password field brings the browser's password manager, and hides a key that needs checking.
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste your key"
          value={apiKey}
          onChange={(event) => onKey(event.target.value)}
        />
        {test.state === "valid" && (
          <span className="text-[13.5px] font-bold text-(--green)">Valid</span>
        )}
        <button type="button" className="key small" disabled={!canTest} onClick={onTest}>
          {test.state === "testing" ? "Testing" : "Test"}
        </button>
      </span>
      {test.state === "valid" && test.balance !== null && (
        <p className="mt-1.5 ml-0.5 text-[13.5px] text-(--ink-soft)">Balance {test.balance}</p>
      )}
      {test.state === "failed" && (
        <p className="mt-1.5 ml-0.5 text-[13.5px] text-(--red)">{test.message}</p>
      )}
      {keyPage !== undefined && (
        <a
          className="mt-2 ml-0.5 self-start text-sm font-semibold text-(--green)"
          href={keyPage}
          target="_blank"
          rel="noreferrer"
        >
          Get a key from {providerLabels[provider]}
        </a>
      )}
    </>
  );
}
