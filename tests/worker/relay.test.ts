import { afterEach, describe, expect, it, vi } from "vitest";
import { relay } from "@/worker/relay";

const target = "https://api.groq.com/openai/v1/chat/completions";

const call = (headers: Record<string, string>, body = "{}"): Request =>
  new Request("https://reader-hero.example/relay", {
    method: "POST",
    headers: { origin: "https://reader-hero.example", ...headers },
    body,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relay", () => {
  it("given a request from another site or from no browser page, refuses with 403 and calls nothing", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const outsider = await relay(
      call({
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "x-relay-target": target,
      }),
    );
    const bare = await relay(
      new Request("https://reader-hero.example/relay", { headers: { "x-relay-target": target } }),
    );
    expect(outsider.status).toBe(403);
    expect(bare.status).toBe(403);
    expect(await outsider.json()).toEqual({ error: { message: "The relay serves only this app" } });
    expect(mock).not.toHaveBeenCalled();
  });

  it("given a same-origin GET, which carries no Origin, forwards it", async () => {
    const mock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", mock);
    const response = await relay(
      new Request("https://reader-hero.example/relay", {
        headers: {
          "sec-fetch-site": "same-origin",
          "x-relay-target": "https://api.groq.com/openai/v1/models",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });

  it("given no target, refuses with 400 and calls nothing", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const response = await relay(call({ authorization: "Bearer k" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: "The relay needs a target URL" } });
    expect(mock).not.toHaveBeenCalled();
  });

  it("given a host outside the list, refuses with 403 and calls nothing", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const response = await relay(call({ "x-relay-target": "https://evil.example/v1/chat" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: "The relay does not reach evil.example" },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it("given a plain-http target, refuses with 403", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const response = await relay(
      call({ "x-relay-target": "http://api.groq.com/openai/v1/chat/completions" }),
    );
    expect(response.status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
  });

  it("given an allowed POST, forwards the needed headers and copies the status", async () => {
    const mock = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response("{}", { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", mock);
    const response = await relay(
      call(
        {
          authorization: "Bearer k",
          "content-type": "application/json",
          cookie: "secret=1",
          "x-relay-target": target,
          "x-opencode-session": "reader-hero:b3",
        },
        '{"a":1}',
      ),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(target);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(headers.get("content-type")).toBe("application/json");
    // Only OpenCode reads it, so another provider never gets the book's id.
    expect(headers.get("x-opencode-session")).toBeNull();
    expect(headers.get("user-agent")).toBe("reader-hero/1.0 (+https://reader-hero.example)");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-relay-target")).toBeNull();
  });

  it("given a body that is still open, passes the first chunk on before the upstream ends", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const upstream = new ReadableStream<Uint8Array>({
      start: (inner) => {
        controller = inner;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(upstream, { status: 200 })),
    );
    controller?.enqueue(new TextEncoder().encode("data: a\n\n"));

    const response = await relay(call({ "x-relay-target": target }));
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("data: a\n\n");

    controller?.enqueue(new TextEncoder().encode("data: b\n\n"));
    controller?.close();
    const second = await reader?.read();
    expect(new TextDecoder().decode(second?.value)).toBe("data: b\n\n");
  });

  it("given a provider that does not answer, refuses with 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const response = await relay(call({ "x-relay-target": target }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { message: "The provider did not answer" } });
  });

  it("given OpenCode as the target, forwards its session header", async () => {
    const mock = vi.fn(async (_url: URL, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", mock);
    await relay(
      call({
        "x-relay-target": "https://opencode.ai/zen/go/v1/chat/completions",
        "x-opencode-session": "reader-hero:b3",
      }),
    );
    const headers = new Headers(mock.mock.calls[0]?.[1].headers);
    expect(headers.get("x-opencode-session")).toBe("reader-hero:b3");
  });

  it("given a path, a port or credentials the app never uses, refuses with 403 and calls nothing", async () => {
    const mock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", mock);
    for (const refused of [
      "https://api.groq.com/openai/v1/files",
      "https://opencode.ai/",
      "https://api.groq.com:8443/openai/v1/chat/completions",
      "https://user:pass@api.groq.com/openai/v1/chat/completions",
    ]) {
      const response = await relay(call({ "x-relay-target": refused }));
      expect(response.status).toBe(403);
    }
    expect(mock).not.toHaveBeenCalled();
  });
});
