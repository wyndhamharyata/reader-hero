import { Hono } from "hono";

interface Bindings {
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get("/healthz", (c) => c.json({ ok: true, app: "reader-hero" }));

// Debug-only sink for logs beaconed from a device Devtools cannot reach.
app.post("/__log", async (c) => {
  const body = await c.req.text();
  console.log(`[device] ${body.slice(0, 2000)}`);
  return c.text("ok");
});

app.on(["GET", "POST"], "/share-target", (c) => c.redirect("/", 303));

app.all("*", (c) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") return c.text("Not found", 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
