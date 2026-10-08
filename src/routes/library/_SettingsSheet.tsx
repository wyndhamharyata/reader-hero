import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ThemeControls } from "@/components/ThemeControls";
import { AiProvider, AiSettings, providerLabels } from "@/domain/ai";
import type { ModelInfo } from "@/lib/ai-transport";
import { runApp, useAiSettings, useSettings } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { AiClient } from "@/services/ai-client";

interface Props {
  open: boolean;
  onClose: () => void;
}

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

type Test =
  | { readonly state: "idle" }
  | { readonly state: "testing" }
  | { readonly state: "valid"; readonly balance: string | null }
  | { readonly state: "failed"; readonly message: string };

export function SettingsSheet({ open, onClose }: Props): ReactElement | null {
  const { ai, putAi } = useAiSettings();
  const { settings, update } = useSettings();
  const [tab, setTab] = useState<"theme" | "summary">("theme");
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const { dismiss } = useBottomSheet(open, sheetRef, backdropRef, onClose);
  useTabSwipe(viewport, track, ["theme", "summary"] as const, tab, setTab);
  const [provider, setProvider] = useState<AiProvider>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("off");
  const [linesInContents, setLinesInContents] = useState(true);
  const [autoSummary, setAutoSummary] = useState(false);
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  const [test, setTest] = useState<Test>({ state: "idle" });

  // Each open starts from the stored record, so a cancelled edit leaves nothing behind.
  useEffect(() => {
    if (!open) return;
    setProvider(ai?.provider ?? "deepseek");
    setApiKey(ai?.apiKey ?? "");
    setModel(ai?.model ?? "");
    setEffort(ai?.effort ?? "off");
    setLinesInContents(ai?.linesInContents ?? true);
    setAutoSummary(ai?.autoSummary ?? false);
    setModels([]);
    setTest({ state: "idle" });
  }, [open, ai]);

  if (!open) return null;

  const draft = (consentedAt?: number): AiSettings =>
    new AiSettings({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      effort: effort === "off" ? undefined : effort,
      consentedAt,
      linesInContents,
      autoSummary,
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
            if (list.length > 0 && !list.some((entry) => entry.id === model)) {
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

  const save = (): void => {
    // Consent is per provider: a new provider asks again on the first action.
    putAi(draft(provider === ai?.provider ? ai?.consentedAt : undefined));
    dismiss();
  };

  const removeKey = (): void => {
    putAi(null);
    dismiss();
  };

  const levels = models.find((entry) => entry.id === model)?.efforts ?? ["low", "medium", "high"];
  // A stored level the model does not list stays choosable, so the select shows what is saved.
  const efforts = [
    "off",
    ...levels,
    ...(effort === "off" || levels.includes(effort) ? [] : [effort]),
  ];
  const ready = apiKey.trim() !== "" && model.trim() !== "";
  const field = "select w-full text-base md:text-sm";

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
          {(["theme", "summary"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className={`tab ${tab === value ? "tab-active" : ""}`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "theme" ? "Theme" : "Summary"}
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
            style={{ transform: `translateX(${tab === "theme" ? 0 : -100}%)` }}
          >
            <div
              className="h-full w-full shrink-0 overflow-y-auto overscroll-contain"
              inert={tab !== "theme"}
            >
              <div className="mx-4 mb-1 rounded-box bg-base-300 p-3">
                <ThemeControls settings={settings} onChange={update} />
              </div>
            </div>
            <div className="flex h-full w-full shrink-0 flex-col" inert={tab !== "summary"}>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <section className="px-4 pt-1">
                  <p className={heading}>Provider</p>
                  <select
                    className={field}
                    aria-label="Provider"
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value as AiProvider);
                      setModels([]);
                      setTest({ state: "idle" });
                    }}
                  >
                    {AiProvider.literals.map((value) => (
                      <option key={value} value={value}>
                        {providerLabels[value]}
                      </option>
                    ))}
                  </select>
                </section>

                <section className="mt-4 px-4">
                  <p className={heading}>API key</p>
                  <div className="flex gap-2">
                    {/* 16px text on phones: iOS zooms the page into any focused input smaller than that. */}
                    <input
                      type="password"
                      className="input w-full text-base md:text-sm"
                      autoComplete="off"
                      aria-label="API key"
                      value={apiKey}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setTest({ state: "idle" });
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={apiKey.trim() === "" || test.state === "testing"}
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
                </section>

                <section className="mt-3 px-4">
                  <p className={heading}>Model</p>
                  {models.length > 0 ? (
                    <select
                      className={field}
                      aria-label="Model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    >
                      {models.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input w-full text-base md:text-sm"
                      aria-label="Model"
                      placeholder="Model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    />
                  )}
                </section>

                <section className="mt-4 px-4">
                  <p className={heading}>Effort</p>
                  <select
                    className={field}
                    aria-label="Effort"
                    value={effort}
                    onChange={(event) => setEffort(event.target.value)}
                  >
                    {efforts.map((level) => (
                      <option key={level} value={level}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm opacity-60 md:text-xs">
                    Higher levels take longer to start.
                  </p>
                </section>

                <section className="mt-4 px-4 pb-1">
                  <p className={heading}>Summary</p>
                  <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
                    <span>Summaries in Contents</span>
                    <input
                      type="checkbox"
                      className="toggle md:toggle-sm"
                      checked={linesInContents}
                      onChange={(event) => setLinesInContents(event.target.checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 py-2 text-base md:text-sm">
                    <span>Automatic summary</span>
                    <input
                      type="checkbox"
                      className="toggle md:toggle-sm"
                      checked={autoSummary}
                      onChange={(event) => setAutoSummary(event.target.checked)}
                    />
                  </label>
                  <p className="text-sm opacity-60 md:text-xs">
                    Automatic summary sends each chapter when it is read.
                  </p>
                </section>
              </div>

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
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
