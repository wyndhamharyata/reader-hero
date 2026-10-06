import { Context, Effect, Layer, Queue, Stream } from "effect";
import { ServiceWorkerFailure } from "@/domain/errors";
import type { WorkerMessage } from "@/domain/worker-message";

export class ServiceWorkerClient extends Context.Service<
  ServiceWorkerClient,
  {
    waiting(): Stream.Stream<ServiceWorker, ServiceWorkerFailure>;
    activate(worker: ServiceWorker): Effect.Effect<void>;
  }
>()("reader-hero/ServiceWorkerClient") {
  static readonly layer = Layer.succeed(
    ServiceWorkerClient,
    ServiceWorkerClient.of({
      // Registers the worker and emits each new version that is installed and waiting to take over.
      waiting: () => {
        if (!("serviceWorker" in navigator)) return Stream.empty;
        return Stream.callback<ServiceWorker, ServiceWorkerFailure>((queue) =>
          Effect.gen(function* () {
            const registration = yield* Effect.tryPromise({
              try: () => navigator.serviceWorker.register("/sw.js", { scope: "/" }),
              catch: (cause) => new ServiceWorkerFailure({ cause }),
            });
            if (registration.waiting !== null) Queue.offerUnsafe(queue, registration.waiting);

            const onFound = (): void => {
              const installing = registration.installing;
              installing?.addEventListener("statechange", () => {
                // With no controller this is the first install, not an update.
                if (
                  installing.state === "installed" &&
                  navigator.serviceWorker.controller !== null
                ) {
                  Queue.offerUnsafe(queue, installing);
                }
              });
            };
            registration.addEventListener("updatefound", onFound);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => registration.removeEventListener("updatefound", onFound)),
            );
          }),
        );
      },
      activate: (worker) =>
        Effect.sync(() => {
          const message: WorkerMessage = { type: "SKIP_WAITING" };
          worker.postMessage(message);
          window.location.reload();
        }),
    }),
  );
}
