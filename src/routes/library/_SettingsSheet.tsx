import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ThemeControls } from "@/components/ThemeControls";
import { AiProvider, AiSettings, CONSENT_VERSION, providerLabels } from "@/domain/ai";
import type { ModelInfo } from "@/lib/ai-transport";
import { runApp, useAiSettings, useJob, useSettings } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { ConsentNote } from "@/routes/reader/_ConsentNote";
import { AiClient } from "@/services/ai-client";

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
  onClose: () => void;
}

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

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
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("off");
  const [linesInContents, setLinesInContents] = useState(true);
  const [autoSummary, setAutoSummary] = useState(false);
  const [seriesGrouping, setSeriesGrouping] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  // The action whose consent note shows, under its own control.
  const [consentFor, setConsentFor] = useState<"grouping" | "names" | null>(null);
  const consentNote = useRef<HTMLDivElement>(null);
  const names = useJob("names");
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  const [test, setTest] = useState<Test>({ state: "idle" });

  // Each open starts from the stored record, so a cancelled edit leaves nothing behind; a toggle's
  // save leaves the Provider fields as they are.
  useEffect(() => {
    if (!open) return;
    setProvider(ai?.provider ?? "deepseek");
    setApiKey(ai?.apiKey ?? "");
    setModel(ai?.model ?? "");
    setEffort(ai?.effort ?? "off");
    setConsentPending(false);
    setConsentFor(null);
    setModels([]);
    setTest({ state: "idle" });
  }, [open, ai?.provider, ai?.apiKey, ai?.model, ai?.effort]);
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
      effort: effort === "off" ? undefined : effort,
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
    const same = provider === ai?.provider;
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
                  Automatic summary sends each chapter when it is read.
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
                <div className="mt-2 flex items-center justify-between gap-3 py-1 text-base md:text-sm">
                  <span>Characters in series</span>
                  {names.run === null ? (
                    <button
                      type="button"
                      className="btn btn-ghost md:btn-sm"
                      disabled={ai === null}
                      onClick={() => {
                        if (ai === null) return;
                        // Only the current consent text names what a later volume's list sends.
                        if (ai.consentedAt === undefined || ai.consentVersion !== CONSENT_VERSION) {
                          setConsentFor("names");
                          return;
                        }
                        names.startNames(ai);
                      }}
                    >
                      Rebuild
                    </button>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="loading loading-sm loading-spinner md:loading-xs" />
                      {names.run.of === 0
                        ? "Starting"
                        : `${names.run.of - names.run.chapter + 1} ${names.run.of - names.run.chapter === 0 ? "volume" : "volumes"} left`}
                      <button
                        type="button"
                        className="btn btn-ghost md:btn-sm"
                        onClick={names.stop}
                      >
                        Stop
                      </button>
                    </span>
                  )}
                </div>
                {consentFor === "names" && ai !== null && (
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
                        names.startNames(next);
                      }}
                    />
                  </div>
                )}
                {names.error !== null && (
                  <p className="text-base text-error md:text-sm">{names.error}</p>
                )}
                <p className="text-sm opacity-60 md:text-xs">
                  Rebuild writes the character list of each later volume in a series again, first
                  volume to last, so each list knows the books before it. It sends one request per
                  volume with a list. Edited characters stay.
                </p>
              </section>
            </div>
            <div className="flex h-full w-full shrink-0 flex-col" inert={tab !== "provider"}>
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
      </aside>
    </div>
  );
}
