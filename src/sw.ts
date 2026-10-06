import { Option, Schema } from "effect";
import { WorkerMessage } from "@/domain/worker-message";
import { openReaderDb } from "@/lib/db";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const CACHE = "reader-hero-shell-v1";
const INDEX = "/index.html";
const SHARE_PATH = "/share-target";

const precacheUrls = self.__WB_MANIFEST.map((entry) => entry.url);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        precacheUrls
          .filter((url) => url !== "index.html")
          .map((url) => new Request(url, { cache: "reload" })),
      );
      // Cloudflare answers /index.html with a 307 to /, and Safari refuses a navigation answered
      // by a redirected response, so the shell is stored from / instead.
      const shell = await fetch(new Request("/", { cache: "reload" }));
      if (!shell.ok) throw new Error(`Shell fetch failed: ${shell.status}`);
      await cache.put(INDEX, shell);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (Option.isSome(Schema.decodeUnknownOption(WorkerMessage)(event.data))) {
    void self.skipWaiting();
  }
});

async function handleShare(request: Request): Promise<Response> {
  const db = await openReaderDb();
  const form = await request.formData();
  const file = form.get("file");
  if (file instanceof File) {
    await db.add("inbox", { name: file.name, blob: file, addedAt: Date.now() });
  }
  return Response.redirect(new URL("/", self.location.origin).toString(), 303);
}

async function handleNavigate(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE);
      await cache.put(INDEX, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(INDEX);
    if (cached !== undefined) return cached;
    return new Response("Offline", { status: 503 });
  }
}

async function handleAsset(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigate(event.request));
    return;
  }

  event.respondWith(handleAsset(event.request));
});
