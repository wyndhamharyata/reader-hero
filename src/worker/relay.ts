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

const forwarded = ["authorization", "content-type", "accept", "x-opencode-session"];

const refuse = (message: string, status: number): Response =>
  Response.json({ error: { message } }, { status });

// Bodies stream straight through: this code logs nothing, stores nothing and never reads them.
export async function relay(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  // Browsers set both headers themselves, so a page on another site cannot borrow the relay; a same-origin GET carries no Origin.
  if (
    request.headers.get("sec-fetch-site") !== "same-origin" &&
    request.headers.get("origin") !== origin
  ) {
    return refuse("The relay serves only this app", 403);
  }
  let url: URL;
  try {
    url = new URL(request.headers.get("x-relay-target") ?? "");
  } catch {
    return refuse("The relay needs a target URL", 400);
  }
  if (url.protocol !== "https:" || !hosts.has(url.hostname)) {
    return refuse(`The relay does not reach ${url.host}`, 403);
  }
  // The provider sees who calls it, with the deployment that did: the app and nothing else.
  const headers = new Headers({ "user-agent": `reader-hero/1.0 (+${origin})` });
  for (const name of forwarded) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Node's fetch, which the dev server uses, refuses a streamed body without `duplex`.
  const init = {
    method: request.method,
    headers,
    body: request.method === "GET" ? null : request.body,
    duplex: "half" as const,
    redirect: "manual" as const,
  };
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
    },
  });
}
