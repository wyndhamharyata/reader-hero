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
    // Without a registered worker the app still runs; it only misses update prompts.
    const fiber = forkApp(watch.pipe(Effect.catchTag("ServiceWorkerFailure", () => Effect.void)));
    return () => stopFiber(fiber);
  }, []);

  if (waiting === null) return null;

  const reload = (): void => {
    void runApp(Effect.flatMap(ServiceWorkerClient, (client) => client.activate(waiting)));
  };

  return (
    <div className="toast toast-center toast-bottom z-50">
      <div className="alert alert-info">
        <span>A new version is ready.</span>
        <button type="button" className="btn btn-sm" onClick={reload}>
          Reload
        </button>
      </div>
    </div>
  );
}
