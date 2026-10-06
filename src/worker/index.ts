import { Hono } from "hono";

interface Bindings {
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get("/healthz", (c) => c.json({ ok: true, app: "reader-hero" }));

app.on(["GET", "POST"], "/share-target", (c) => c.redirect("/", 303));

app.all("*", (c) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") return c.text("Not found", 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
