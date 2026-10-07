import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { AiMessage, AiSettings, Artifact } from "@/domain/ai";
import { describeAiFailure } from "@/lib/describe-error";
import { forkApp, stopFiber, type Job } from "@/lib/hooks";
import { useBottomSheet } from "@/lib/use-bottom-sheet";
import { chapterAt } from "@/use-cases/ai-context";
import {
  followUp,
  runRecap,
  storedRecap,
  type RecapInput,
  type RecapScope,
} from "@/use-cases/recap";
import { ConsentNote } from "./_ConsentNote";

interface Props {
  input: RecapInput;
  settings: AiSettings;
  // How many chapters before the position the summary does not cover. Over one, the Read so far
  // scope first offers the summary job, so the request stays small.
  behind: number;
  summary: { readonly row: string; readonly action: string | null; readonly running: boolean };
  onSummarise: () => void;
  onScope: (scope: RecapScope) => void;
  onConsent: () => void;
  onClose: () => void;
}

type Phase =
  | { readonly state: "waiting" }
  | { readonly state: "streaming" }
  | { readonly state: "done" }
  | { readonly state: "behind" }
  | { readonly state: "error"; readonly message: string };

// The recap over the text. A stored result shows at once; otherwise the answer streams in and is
// stored when it ends. Closing mid-stream interrupts the request and stores nothing.
export function ResultSheet({
  input,
  settings,
  behind,
  summary,
  onSummarise,
  onScope,
  onConsent,
  onClose,
}: Props): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [text, setText] = useState("");
  const [thread, setThread] = useState<ReadonlyArray<AiMessage>>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "waiting" });
  const [question, setQuestion] = useState("");
  const [nonce, setNonce] = useState(0);
  const artifact = useRef<Artifact | null>(null);
  const job = useRef<Job | null>(null);
  const consented = settings.consentedAt !== undefined;

  useEffect(() => {
    if (!consented) return;
    setText("");
    setThread([]);
    setPending(null);
    artifact.current = null;
    if (input.scope === "sofar" && behind > 1) {
      setPhase({ state: "behind" });
      return;
    }
    setPhase({ state: "waiting" });
    const show = (found: Artifact): void => {
      artifact.current = found;
      setText(found.result);
      setThread(found.thread);
      setPhase({ state: "done" });
    };
    const program = Effect.gen(function* () {
      const stored = yield* storedRecap(input, settings);
      if (stored !== null) return stored;
      return yield* runRecap(input, settings, (soFar) => {
        setText(soFar);
        setPhase({ state: "streaming" });
      });
    }).pipe(
      Effect.match({
        onSuccess: show,
        onFailure: (error) => setPhase({ state: "error", message: describeAiFailure(error) }),
      }),
    );
    const fiber = forkApp(program);
    job.current = fiber;
    return () => stopFiber(fiber);
  }, [input, settings, consented, nonce, behind]);

  const ask = (): void => {
    const current = artifact.current;
    const asked = question.trim();
    if (current === null || asked === "" || phase.state !== "done") return;
    setQuestion("");
    setPending("");
    setPhase({ state: "waiting" });
    const program = followUp(input, settings, current, asked, (soFar) => {
      setPending(soFar);
      setPhase({ state: "streaming" });
    }).pipe(
      Effect.match({
        onSuccess: (next) => {
          artifact.current = next;
          setThread(next.thread);
          setPending(null);
          setPhase({ state: "done" });
        },
        onFailure: (error) => {
          setPending(null);
          setPhase({ state: "error", message: describeAiFailure(error) });
        },
      }),
    );
    job.current = forkApp(program);
  };

  const cancel = (): void => {
    if (job.current !== null) stopFiber(job.current);
    dismiss();
  };

  const busy = phase.state === "waiting" || phase.state === "streaming";
  const heading = chapterAt(input.parsed, input.index).heading;
  const label = heading === "" ? `page ${input.parsed.blocks[input.index]?.page ?? 1}` : heading;

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-black/40 motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={cancel}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Recap"
        className="relative z-10 mx-auto flex max-h-[75%] w-full max-w-xl flex-col rounded-t-box bg-base-100 p-4 pb-[calc(var(--safe-bottom)+0.5rem)] motion-safe:animate-sheet-up md:max-h-[80vh] md:rounded-box md:pb-4"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Recap · {label}</p>

        {!consented ? (
          <ConsentNote provider={settings.provider} onCancel={cancel} onAllow={onConsent} />
        ) : (
          <>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {phase.state === "behind" && (
                <div className="text-sm">
                  <p>Summary · {summary.row}</p>
                  {summary.running ? (
                    <p className="mt-2 flex items-center gap-2 opacity-70">
                      <span className="loading loading-xs loading-spinner" />
                      The recap runs when the summary is one chapter behind at most.
                    </p>
                  ) : (
                    summary.action !== null && (
                      <button
                        type="button"
                        className="btn mt-2 btn-primary btn-sm"
                        onClick={onSummarise}
                      >
                        {summary.action}
                      </button>
                    )
                  )}
                </div>
              )}
              {phase.state === "waiting" && pending === null && text === "" && (
                <p className="flex items-center gap-2 text-sm opacity-70">
                  <span className="loading loading-xs loading-spinner" />
                  Waiting for the provider…
                </p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
              {thread.map((message, index) => (
                <p
                  key={index}
                  className={`mt-3 text-sm leading-relaxed whitespace-pre-wrap ${message.role === "user" ? "font-medium" : ""}`}
                >
                  {message.content}
                </p>
              ))}
              {pending !== null && (
                <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {pending === "" ? (
                    <span className="flex items-center gap-2 opacity-70">
                      <span className="loading loading-xs loading-spinner" />
                      Waiting for the provider…
                    </span>
                  ) : (
                    pending
                  )}
                </p>
              )}
              {phase.state === "error" && (
                <p className="mt-2 flex items-center gap-3 text-sm text-error">
                  {phase.message}
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setNonce((value) => value + 1)}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              {(
                [
                  ["recent", "Recent pages"],
                  ["chapter", "Chapter"],
                  ["sofar", "Read so far"],
                ] as const
              ).map(([scope, name]) => (
                <button
                  key={scope}
                  type="button"
                  className={`btn rounded-full btn-xs ${input.scope === scope ? "btn-neutral" : ""}`}
                  aria-pressed={input.scope === scope}
                  disabled={busy}
                  onClick={() => onScope(scope)}
                >
                  {name}
                </button>
              ))}
            </div>

            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                ask();
              }}
            >
              <input
                type="text"
                className="input flex-1 text-base input-sm md:text-sm"
                placeholder="Follow-up…"
                aria-label="Follow-up"
                value={question}
                disabled={phase.state !== "done"}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={phase.state !== "done" || question.trim() === ""}
              >
                Send
              </button>
            </form>

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={text === ""}
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                Copy
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
                {busy ? "Cancel" : "Close"}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
