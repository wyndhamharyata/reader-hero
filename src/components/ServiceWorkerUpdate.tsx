import { useEffect, useState } from "react";

export function ServiceWorkerUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      if (!active) return;
      if (registration.waiting !== null) setWaiting(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller !== null) {
            setWaiting(installing);
          }
        });
      });
    });

    return () => {
      active = false;
    };
  }, []);

  if (waiting === null) return null;

  const reload = () => {
    waiting.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
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
