// The relay reaches only these hosts, so the Worker cannot serve as an open proxy.
const hosts = new Set([
  "api.groq.com",
  "api.cerebras.ai",
  "api.z.ai",
  "opencode.ai",
  "integrate.api.nvidia.com",
  "api.cloudflare.com",
  "api.mistral.ai",
  "api.together.xyz",
]);

const forwarded = ["authorization", "content-type", "accept"];

// Only the app's two calls, under any base path, so a custom base URL still works.
const allowedCall = (method: string, path: string): boolean =>
  (method === "POST" && path.endsWith("/chat/completions")) ||
  (method === "GET" && path.endsWith("/models"));

const refuse = (message: string, status: number): Response =>
  Response.json({ error: { message } }, { status });

// Bodies stream straight through: this code logs nothing, stores nothing and never reads them.
export async function relay(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;

  // Browsers set both headers themselves, so a page on another site cannot borrow the relay. A same-origin GET carries no Origin.
  if (!isSameSite(request, origin)) return refuse("The relay serves only this app", 403);

  const url = targetOf(request);

  if (url === null) return refuse("The relay needs a target URL", 400);

  if (!isAllowedTarget(url)) return refuse(`The relay does not reach ${url.host}`, 403);
  if (!allowedCall(request.method, url.pathname)) {
    return refuse("The relay passes on only chat and model list calls", 403);
  }

  const headers = forwardedHeaders(request, origin, url);
  const init = initOf(request, headers);
  let upstream: Response;

  try {
    upstream = await fetch(url, init);
  } catch {
    return refuse("The provider did not answer", 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      // Served from the app's origin, so never sniffed as another type.
      "x-content-type-options": "nosniff",
    },
  });
}

function isSameSite(request: Request, origin: string): boolean {
  return (
    request.headers.get("sec-fetch-site") === "same-origin" ||
    request.headers.get("origin") === origin
  );
}

function targetOf(request: Request): URL | null {
  try {
    return new URL(request.headers.get("x-relay-target") ?? "");
  } catch {
    return null;
  }
}

function isAllowedTarget(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    hosts.has(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

function forwardedHeaders(request: Request, origin: string, target: URL): Headers {
  // The provider sees who calls it, with the deployment that did: the app and nothing else.
  const headers = new Headers({ "user-agent": `reader-hero/1.0 (+${origin})` });

  for (const name of forwarded) {
    const value = request.headers.get(name);

    if (value !== null) headers.set(name, value);
  }

  // Only OpenCode reads its session header, so no other provider gets the book's id in it.
  const session = request.headers.get("x-opencode-session");

  if (session !== null && target.hostname === "opencode.ai")
    headers.set("x-opencode-session", session);

  return headers;
}

function initOf(request: Request, headers: Headers) {
  // Node's fetch, which the dev server uses, refuses a streamed body without `duplex`.
  return {
    method: request.method,
    headers,
    body: request.method === "GET" ? null : request.body,
    duplex: "half" as const,
    redirect: "manual" as const,
    // A reader who stops a request ends it upstream too, so the provider stops writing.
    signal: request.signal,
  };
}
