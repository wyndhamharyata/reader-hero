import { Effect, Stream } from "effect";
import { useEffect, useState, type ReactElement } from "react";
import { forkApp, runApp, stopFiber } from "@/lib/hooks";
import { ServiceWorkerClient } from "@/services/service-worker-client";

export function ServiceWorkerUpdate(): ReactElement | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const watch = Effect.flatMap(ServiceWorkerClient, (client) =>
      Stream.runForEach(client.waiting(), (worker) => Effect.sync(() => setWaiting(worker))),
    );
    // Without a registered worker the app still runs. It only misses update prompts.
    const fiber = forkApp(watch.pipe(Effect.catchTag("ServiceWorkerFailure", () => Effect.void)));

    return () => stopFiber(fiber);
  }, []);

  if (waiting === null) return null;

  const reload = (): void => {
    void runApp(Effect.flatMap(ServiceWorkerClient, (client) => client.activate(waiting)));
  };

  return (
    <div className="notice rise fixed inset-x-4 bottom-[calc(var(--safe-bottom)+1.5rem)] z-[70] flex items-center gap-3 shadow-(--shadow-panel) md:inset-x-auto md:left-1/2 md:w-96 md:-translate-x-1/2">
      <span className="flex-1 font-semibold">A new version is ready</span>
      <button type="button" className="key small green" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
