// The original view's scroll alone, on a fresh profile: npm run bench:probe -- <label> [mobile]
// Env: SAMPLE=1 samples the content process during the scroll (macOS `sample`, written to
// .bench/sample.txt); IOSTATS=1 times every IntersectionObserver callback with its React flush.
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devices, webkit } from "playwright";
import { makeBenchPdf } from "./make-pdf.mjs";
import { benchDir } from "./paths.mjs";
import { startServer } from "./serve.mjs";

const label = process.argv[2] ?? "probe";
const mobile = process.argv[3] === "mobile";
if (!existsSync(join(benchDir, "bench.pdf"))) makeBenchPdf(join(benchDir, "bench.pdf"));
const { server, url: base } = await startServer(0);

const cpuSeconds = () => {
  const out = execSync(
    "ps -Ao cputime,command | grep 'WebKit.WebContent' | grep -v grep || true",
  ).toString();
  let total = 0;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+):(\d+)\.(\d+)/);
    if (m) total += Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
  }
  return total;
};

const context = await webkit.launchPersistentContext(
  mkdtempSync(join(tmpdir(), "rh-probe-")),
  mobile ? { ...devices["iPhone 14"] } : { viewport: { width: 1280, height: 900 } },
);
if (process.env.IOSTATS) {
  await context.addInitScript(`
    window.__io = {};
    const Original = window.IntersectionObserver;
    window.IntersectionObserver = class extends Original {
      constructor(callback, options) {
        const key = (options && options.rootMargin) || "none";
        super((entries, observer) => {
          const start = performance.now();
          callback(entries, observer);
          setTimeout(() => {
            const stat = (window.__io[key] ??= { calls: 0, totalMs: 0, maxMs: 0, entries: 0 });
            const ms = performance.now() - start;
            stat.calls += 1; stat.totalMs += ms; stat.maxMs = Math.max(stat.maxMs, ms); stat.entries += entries.length;
          }, 0);
        }, options);
      }
    };
  `);
}
const page = context.pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const libraryReady = () =>
  document.querySelector("main") &&
  ![...document.querySelectorAll("main p")].some((p) =>
    p.textContent.startsWith("Loading library"),
  );
await page.goto(base);
await page.waitForFunction(libraryReady);
await page.evaluate(async () => {
  const blob = await (await fetch("/__bench/bench.pdf")).blob();
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "bench.pdf", { type: "application/pdf" }));
  const input = document.querySelector("input[type=file]");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForFunction(
  () =>
    document.querySelector('li.card a[href^="/book/"]') !== null &&
    !document.body.innerText.includes("rendering figures"),
  null,
  { timeout: 180_000 },
);
await page.click('li.card a[href^="/book/"]');
await page.waitForSelector("[data-block]");
// Reading time before the switch, as in the full benchmark, so the warm-up has run.
await page.waitForTimeout(3000);
await page.click('button[aria-label="Menu"]');
await page.waitForSelector('button:has-text("Original view")');
// The sheet animates in for 240 ms; the timed click must not wait on that.
await page.waitForTimeout(400);
const t0 = Date.now();
await page.click('button:has-text("Original view")');
await page.click('button[aria-label="Close"]');
await page.waitForFunction(
  () => [...document.querySelectorAll("canvas")].some((c) => c.width > 0 && c.width !== 300),
  null,
  { timeout: 60_000 },
);
const firstPageMs = Date.now() - t0;
await page.waitForTimeout(1500);
const cpu = cpuSeconds();
if (process.env.SAMPLE) {
  const pid = execSync("pgrep -n -f WebKit.WebContent").toString().trim();
  execSync(`(sample ${pid} 4 -file ${join(benchDir, "sample.txt")} >/dev/null 2>&1 &)`);
  await page.waitForTimeout(300);
}
const result = await page.evaluate(async () => {
  const container = document.querySelector(".overflow-y-auto.bg-base-300");
  // What one canvas size change costs: in WebKit it lays out every page wrapper again.
  const probeCanvas = document.querySelectorAll("canvas")[10];
  void container.offsetHeight;
  const t = performance.now();
  probeCanvas.width += 1;
  void container.offsetHeight;
  const canvasResizeLayoutMs = Math.round(performance.now() - t);
  probeCanvas.width -= 1;
  await new Promise((r) => setTimeout(r, 300));

  const gaps = [];
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (let i = 0; i < 15; i += 1) {
    container.scrollTop += 4000;
    await new Promise((r) => setTimeout(r, 120));
  }
  for (let i = 0; i < 15; i += 1) {
    container.scrollTop -= 4000;
    await new Promise((r) => setTimeout(r, 120));
  }
  running = false;
  const sorted = [...gaps].sort((a, b) => a - b);
  const over = gaps.filter((g) => g > 34);
  await new Promise((r) => setTimeout(r, 2500));
  return {
    canvasResizeLayoutMs,
    frames: gaps.length,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    max: Math.round(sorted[sorted.length - 1]),
    over34: over.length,
    blockedMs: Math.round(over.reduce((s, g) => s + g - 17, 0)),
    failed: [...document.querySelectorAll("p")].filter((p) =>
      p.textContent.includes("could not be rendered"),
    ).length,
    io: window.__io,
  };
});
result.cpuS = Math.round((cpuSeconds() - cpu) * 100) / 100;
result.firstPageMs = firstPageMs;
console.log(
  `[${label}/${mobile ? "mobile" : "desktop"}]`,
  JSON.stringify(result),
  errors.length ? errors.slice(0, 3) : "",
);
await context.close();
server.close();
