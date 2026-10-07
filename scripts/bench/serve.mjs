// Serves dist/client with an SPA fallback, a switchable delay on navigations, and the benchmark PDF.
// Standalone, for Safari and its Web Inspector: node scripts/bench/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { benchDir, distRoot } from "./paths.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".icc": "application/octet-stream",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function startServer(port) {
  let navDelay = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/__delay/")) {
      navDelay = Number(url.pathname.slice("/__delay/".length)) || 0;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`navDelay=${navDelay}`);
      return;
    }
    if (url.pathname === "/__bench/bench.pdf") {
      response.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store" });
      response.end(await readFile(join(benchDir, "bench.pdf")));
      return;
    }
    let file = join(distRoot, normalize(decodeURIComponent(url.pathname)));
    let isNavigation = false;
    try {
      const info = await stat(file);
      if (info.isDirectory()) throw new Error("dir");
    } catch {
      file = join(distRoot, "index.html");
      isNavigation = true;
    }
    // A delayed navigation stands in for a weak mobile network.
    if (isNavigation && navDelay > 0) await sleep(navDelay);
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) =>
    // Port 0 lets the OS pick a free port, so two runs never collide.
    server.listen(port, () =>
      resolve({
        server,
        url: `http://localhost:${server.address().port}`,
        setDelay: (ms) => {
          navDelay = ms;
        },
      }),
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.argv[2] ?? 4173));
  console.log(`serving dist/client on ${url}; set a navigation delay with ${url}/__delay/<ms>`);
}
