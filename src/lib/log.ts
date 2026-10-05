import { record } from "@/lib/perf";

const STORAGE_KEY = "reader-hero.log-url";
const DEFAULT_ENDPOINT = "/__log";

/** Where logs are sent, or null outside a browser. */
function destination(): string | null {
  const scope = globalThis as { location?: { search: string }; localStorage?: Storage };
  if (scope.location === undefined || scope.localStorage === undefined) return null;
  const store = scope.localStorage;
  const asked = new URLSearchParams(scope.location.search).get("log");
  if (asked !== null) {
    if (asked === "") store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, asked);
  }
  return store.getItem(STORAGE_KEY) ?? DEFAULT_ENDPOINT;
}

/**
 * Records a measurement in the on-device store and beacons it to the dev
 * server, so a device reached over the tailnet can be inspected from the
 * machine.
 */
export function log(name: string, detail = "", ms = 0): void {
  record(name, ms, detail);
  const url = destination();
  if (url === null) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ at: Date.now(), name, detail, ms }),
    keepalive: true,
  }).catch(() => {});
}
