import { Option, Schema } from "effect";
import { WorkerMessage } from "@/domain/worker-message";
import { openReaderDb } from "@/lib/db";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const INDEX = "/index.html";
const SHARE_PATH = "/share-target";

// Workbox fills this one reference at build time.
const manifest = self.__WB_MANIFEST;
const precacheUrls = manifest.map((entry) => entry.url);

// One cache per build, named by its files' revisions, so activate drops the last build's and a waiting worker
// never writes into the cache the live one serves.
const CACHE = `reader-hero-shell-${hash(manifest.map((entry) => `${entry.url}@${entry.revision}`).join("\n"))}`;

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return (value >>> 0).toString(36);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        precacheUrls
          .filter((url) => url !== "index.html")
          .map((url) => new Request(url, { cache: "reload" })),
      );
      // Safari refuses a navigation answered by a redirect, and Cloudflare 307s /index.html to /.
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

// The library opens whatever happens; a share it could not store is lost, but never shows an error page.
async function handleShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) {
      const db = await openReaderDb();
      await db.add("inbox", { name: file.name, blob: file, addedAt: Date.now() });
    }
  } catch {
    // Nothing to keep: the redirect below still opens the app.
  }
  return Response.redirect(new URL("/", self.location.origin).toString(), 303);
}

// The shell comes only from the cache: a launch never waits, and it must match this build's assets.
async function handleNavigate(request: Request): Promise<Response> {
  const cached = await (await caches.open(CACHE)).match(INDEX);
  if (cached !== undefined) return cached;
  try {
    return await fetch(request);
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function handleAsset(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;

  const response = await fetch(request);
  // A partial answer to a range request cannot be stored.
  if (response.status === 200 && response.type === "basic") {
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

  // The relay answers per provider and key, and nothing it returns may be stored.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/relay"
  )
    return;

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigate(event.request));
    return;
  }

  event.respondWith(handleAsset(event.request));
});
