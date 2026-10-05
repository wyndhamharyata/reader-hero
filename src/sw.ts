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
    caches.open(CACHE).then((cache) => cache.addAll(precacheUrls)),
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
  const data: unknown = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "SKIP_WAITING") {
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
  return Response.redirect(new URL("/?shared=1", self.location.origin).toString(), 303);
}

async function handleNavigate(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE);
    await cache.put(INDEX, response.clone());
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
