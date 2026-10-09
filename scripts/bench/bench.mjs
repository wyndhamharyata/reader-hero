// WebKit benchmark of the built app: npm run bench -- <label>
// Runs the desktop and the mobile (md breakpoint) layout, each in a fresh profile, and writes
// .bench/results/<label>-<layout>.json. Compare two labels with npm run bench:compare.
//
// Measured: launch on a slow network and offline, import plus the figure job, reader open,
// reader scrolling, and the original view. WebKit cannot throttle its CPU, so the work-done
// metric is the content process's CPU seconds per scenario, next to frame gaps.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devices, webkit } from "playwright";
import { makeBenchPdf } from "./make-pdf.mjs";
import { benchDir, distRoot } from "./paths.mjs";
import { startServer } from "./serve.mjs";

const label = process.argv[2] ?? "run";
if (!existsSync(join(distRoot, "index.html"))) {
  console.error("No build found: run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(join(benchDir, "bench.pdf"))) makeBenchPdf(join(benchDir, "bench.pdf"));
const { server, url: base, setDelay } = await startServer(0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
// Every in-page promise gets a deadline, so a stuck step fails the layout instead of hanging the run.
const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what}`)), ms)),
  ]);
// CPU seconds used so far by WebKit's content processes: work done, even when no frame drops.
const cpuSeconds = () => {
  const out = execSync(
    "ps -Ao cputime,command | grep 'WebKit.WebContent' | grep -v grep || true",
  ).toString();
  let total = 0;
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+):(\d+)\.(\d+)/);
    if (match) total += Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100;
  }
  return total;
};

const layouts = {
  desktop: { viewport: { width: 1280, height: 900 } },
  mobile: { ...devices["iPhone 14"] },
};

// Installed into every page: a ready-watcher, a frame-gap sampler and a books reader.
const initScript = `
  window.__ready = null;
  // One watch at a time: an earlier one left running could set __ready for this one.
  window.__watch = (test) => {
    window.__watching?.disconnect();
    window.__ready = null;
    const check = () => {
      if (window.__ready === null && test()) {
        window.__ready = performance.now();
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(check);
    window.__watching = observer;
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  };
  window.__summary = (gaps) => {
    const sorted = [...gaps].sort((a, b) => a - b);
    const over34 = gaps.filter((g) => g > 34);
    return {
      frames: gaps.length,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
      over34: over34.length,
      blockedMs: Math.round(over34.reduce((sum, g) => sum + g - 17, 0)),
    };
  };
  window.__sample = (durationMs, step, container) =>
    new Promise((resolve) => {
      const gaps = [];
      let last = performance.now();
      const start = last;
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (container) container.scrollTop += step;
        if (now - start < durationMs) requestAnimationFrame(tick);
        else resolve(window.__summary(gaps));
      };
      requestAnimationFrame(tick);
    });
  window.__startSampler = () => {
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
    window.__stopSampler = () => {
      running = false;
      return window.__summary(gaps);
    };
  };
  window.__books = () =>
    new Promise((resolve) => {
      const request = indexedDB.open("reader-hero");
      request.onsuccess = () => {
        const db = request.result;
        try {
          const all = db.transaction("books").objectStore("books").getAll();
          all.onsuccess = () => { db.close(); resolve(all.result); };
          all.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
      request.onerror = () => resolve([]);
    });
`;

const libraryReady = `() => {
  const main = document.querySelector("main");
  if (main === null) return false;
  for (const p of main.querySelectorAll("p")) if (p.textContent.startsWith("Loading library")) return false;
  return true;
}`;

async function measureLaunch(page, tag) {
  await page.addInitScript(
    `window.addEventListener("DOMContentLoaded", () => window.__watch(${libraryReady}));`,
  );
  const started = Date.now();
  await page.goto(base, { waitUntil: "commit" }).catch(() => undefined);
  await page.waitForFunction(() => window.__ready !== null, null, { timeout: 60_000 });
  const inPage = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance
      .getEntriesByType("paint")
      .find((e) => e.name === "first-contentful-paint");
    return {
      readyMs: Math.round(window.__ready),
      responseStartMs: Math.round(nav?.responseStart ?? -1),
      fcpMs: paint ? Math.round(paint.startTime) : null,
    };
  });
  return { tag, wallMs: Date.now() - started, ...inPage };
}

async function run(layoutName, layout) {
  // A persistent profile: WebKit's memory-backed storage for an ephemeral context cannot hold a File.
  const context = await webkit.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "rh-bench-")),
    layout,
  );
  await context.addInitScript(initScript);
  const page = context.pages()[0] ?? (await context.newPage());
  const result = { label, layout: layoutName, when: new Date().toISOString() };
  const log = (...args) => console.log(`[${label}/${layoutName}]`, ...args);

  try {
    // 1. First visit: service worker install and precache. Only an active worker that controls
    // this page, with the shell stored, makes a launch representative.
    setDelay(0);
    let t = Date.now();
    await page.goto(base);
    await page.waitForFunction(
      async () => {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active === null || !navigator.serviceWorker.controller) return false;
        return (await caches.match("/index.html")) !== undefined;
      },
      null,
      { timeout: 90_000 },
    );
    result.installMs = Date.now() - t;

    // 2. Launches: slow network, then offline.
    setDelay(1500);
    const launches = [];
    for (let i = 0; i < 3; i += 1) launches.push(await measureLaunch(page, `slow-${i}`));
    setDelay(0);
    await context.setOffline(true);
    let offline;
    try {
      offline = await measureLaunch(page, "offline");
    } catch (error) {
      offline = { tag: "offline", error: String(error).slice(0, 120) };
    }
    await context.setOffline(false);
    result.launch = {
      slowNetworkReadyMs: median(launches.map((l) => l.readyMs)),
      offline,
      runs: launches,
    };
    log(
      "launch: slow network",
      result.launch.slowNetworkReadyMs,
      "ms; offline",
      offline.readyMs ?? offline.error,
      "ms",
    );

    // 3. Import the PDF, time the parse and the figure job, sample frames meanwhile.
    await page.goto(base);
    await page.waitForFunction(libraryReady);
    await page.evaluate(() => window.__startSampler());
    let cpu = cpuSeconds();
    t = Date.now();
    // The file is built in the page: WebKit's IndexedDB rejects a File that Playwright injects.
    await page.evaluate(async () => {
      const blob = await (await fetch("/__bench/bench.pdf")).blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "bench.pdf", { type: "application/pdf" }));
      const input = document.querySelector("input[type=file]");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let parseMs = null;
    let figuresMs = null;
    while (Date.now() - t < 240_000) {
      const books = await withTimeout(
        page.evaluate(() => window.__books()),
        15_000,
        "books",
      );
      const book = books[0];
      if (
        book &&
        parseMs === null &&
        (book.parseState === "ready" || book.parseState === "scanned")
      ) {
        parseMs = Date.now() - t;
      }
      if (book && book.figures === "ready") {
        figuresMs = Date.now() - t;
        break;
      }
      if (book && book.figures === "none" && parseMs !== null) {
        figuresMs = -1;
        break;
      }
      const warning = await page.evaluate(
        () => document.querySelector(".alert-warning")?.textContent ?? null,
      );
      if (warning !== null) {
        result.importError = warning.slice(0, 160);
        log("import failed:", result.importError);
        break;
      }
      await sleep(100);
    }
    result.import = {
      parseMs,
      figuresMs,
      cpuS: Math.round((cpuSeconds() - cpu) * 100) / 100,
      frames: await withTimeout(
        page.evaluate(() => window.__stopSampler()),
        15_000,
        "sampler",
      ),
    };
    log("import: parsed", parseMs, "ms; figures", figuresMs, "ms; CPU", result.import.cpuS, "s");

    // 4. Open the reader.
    await page.evaluate(() => {
      window.__t0 = performance.now();
      window.__watch(() => document.querySelector("[data-block]") !== null);
    });
    await page.click('li.card a[href^="/book/"]');
    await page.waitForFunction(() => window.__ready !== null);
    const readerOpenMs = await page.evaluate(() => Math.round(window.__ready - window.__t0));
    await sleep(1500);
    const blockCount = await page.evaluate(() => document.querySelectorAll("[data-block]").length);

    // 5. Reader scrolling: steady, then flings.
    cpu = cpuSeconds();
    const steady = await withTimeout(
      page.evaluate(() => {
        const container = document.querySelector("[data-block]").closest(".overflow-y-auto");
        container.scrollTop = 0;
        return window.__sample(4000, 24, container);
      }),
      20_000,
      "steady",
    );
    steady.cpuS = Math.round((cpuSeconds() - cpu) * 100) / 100;
    cpu = cpuSeconds();
    const fling = await withTimeout(
      page.evaluate(async () => {
        const container = document.querySelector("[data-block]").closest(".overflow-y-auto");
        window.__startSampler();
        for (let i = 0; i < 12; i += 1) {
          container.scrollTop += 6000;
          await new Promise((r) => setTimeout(r, 120));
        }
        for (let i = 0; i < 12; i += 1) {
          container.scrollTop -= 6000;
          await new Promise((r) => setTimeout(r, 120));
        }
        await new Promise((r) => setTimeout(r, 500));
        return window.__stopSampler();
      }),
      30_000,
      "fling",
    );
    fling.cpuS = Math.round((cpuSeconds() - cpu) * 100) / 100;
    result.reader = { openMs: readerOpenMs, blockCount, steady, fling };
    log(
      "reader: open",
      readerOpenMs,
      "ms;",
      blockCount,
      "blocks; steady CPU",
      steady.cpuS,
      "s; fling CPU",
      fling.cpuS,
      "s",
    );

    // 6. Original mode: time to the first page, then a fast scroll down and back.
    await page.click('button[aria-label="Menu"]');
    await page.waitForSelector('button:has-text("Original view")');
    // The sheet animates in for 240 ms; the timed click must not wait on that.
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__t0 = performance.now();
      window.__opened = null;
      window.__sized = null;
      window.__watch(() => {
        if (window.__opened === null && document.querySelector("[data-page]") !== null) {
          window.__opened = performance.now();
        }
        // A build without the painted mark sizes a canvas when its paint starts.
        if (
          window.__sized === null &&
          [...document.querySelectorAll("canvas")].some((c) => c.width > 0 && c.width !== 300)
        ) {
          window.__sized = performance.now();
        }
        return document.querySelector("canvas[data-painted]") !== null;
      });
    });
    await page.click('button:has-text("Original view")');
    await page.click('button[aria-label="Close"]');
    await page
      .waitForFunction(() => window.__ready !== null, null, { timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForFunction(() => window.__sized !== null, null, { timeout: 120_000 });
    const openMs = await page.evaluate(() => Math.round(window.__opened - window.__t0));
    const firstPageMs = await page.evaluate(() =>
      Math.round((window.__ready ?? window.__sized) - window.__t0),
    );
    const measures = await page.evaluate(() =>
      Object.fromEntries(
        performance
          .getEntriesByType("measure")
          .filter((m) => m.name.startsWith("reader-hero:"))
          .map((m) => [m.name.slice("reader-hero:".length), Math.round(m.duration)]),
      ),
    );
    await sleep(1500);
    cpu = cpuSeconds();
    const originalScroll = await withTimeout(
      page.evaluate(async () => {
        const container = document.querySelector(".overflow-y-auto.bg-base-300");
        window.__startSampler();
        for (let i = 0; i < 15; i += 1) {
          container.scrollTop += 4000;
          await new Promise((r) => setTimeout(r, 120));
        }
        for (let i = 0; i < 15; i += 1) {
          container.scrollTop -= 4000;
          await new Promise((r) => setTimeout(r, 120));
        }
        const frames = window.__stopSampler();
        await new Promise((r) => setTimeout(r, 3000));
        const failed = [...document.querySelectorAll("p")].filter((p) =>
          p.textContent.includes("could not be rendered"),
        ).length;
        return { frames, failedPages: failed };
      }),
      60_000,
      "originalScroll",
    );
    originalScroll.cpuS = Math.round((cpuSeconds() - cpu) * 100) / 100;
    result.original = { openMs, firstPageMs, measures, ...originalScroll };
    log(
      "original: open",
      openMs,
      "ms; first page painted",
      firstPageMs,
      "ms;",
      JSON.stringify(measures),
      "ms; scroll CPU",
      originalScroll.cpuS,
      "s; long frames",
      originalScroll.frames.over34,
    );

    if (layoutName === "mobile") {
      await page.goto(base);
      await page.waitForFunction(libraryReady);
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("reader-hero");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction(["books", "progress", "images", "series"], "readwrite");
        const done = new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        const books = tx.objectStore("books");
        const progress = tx.objectStore("progress");
        const images = tx.objectStore("images");
        const series = tx.objectStore("series");
        books.clear();
        progress.clear();
        images.clear();
        series.clear();
        const cover = new Blob(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><rect width="2" height="3" fill="#456"/></svg>',
          ],
          { type: "image/svg+xml" },
        );
        const now = Date.now();
        for (let seriesIndex = 0; seriesIndex < 10; seriesIndex += 1) {
          const name = `Bench Series ${String(seriesIndex + 1).padStart(2, "0")}`;
          const id = name.toLowerCase();
          const members = [];
          for (let volume = 0; volume < 20; volume += 1) {
            const bookId = `bench-${seriesIndex}-${volume}`;
            members.push({ id: bookId, number: volume + 1 });
            books.put({
              id: bookId,
              title: `${name} Volume ${String(volume + 1).padStart(2, "0")}`,
              author: "Benchmark Author",
              series: name,
              seriesNumber: volume + 1,
              format: "epub",
              addedAt: now + seriesIndex * 20 + volume,
              fileSize: 4096,
              pageCount: 200,
              parseState: "ready",
              charCount: 20000,
              figures: "ready",
            });
            images.put({ blob: cover, width: 400, height: 600 }, `${bookId}/cover`);
            if (volume === 9) {
              progress.put({ blockIndex: 50, percent: 0.25, updatedAt: now + seriesIndex }, bookId);
            }
          }
          series.put({ id, name, books: members, possible: [], edited: true, removed: [] });
        }
        await done;
        db.close();
      });
      await page.reload();
      await page.waitForFunction(libraryReady);
      await page.waitForFunction(() => document.querySelectorAll("[data-series-root]").length > 0);
      await page.waitForTimeout(1000);
      result.series = { books: 200, series: 10, cycles: 10, runs: [] };

      for (const view of ["list", "grid"]) {
        const viewLabel = view === "list" ? "List view" : "Grid view";
        await page.getByRole("button", { name: viewLabel }).click();
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll("button[aria-label]")].some(
              (button) =>
                button.getAttribute("aria-label") === label &&
                button.getAttribute("aria-pressed") === "true",
            ),
          viewLabel,
        );

        for (const position of ["top", "middle"]) {
          await page.evaluate((where) => {
            const scroll = document.querySelector("[data-library-scroll]");
            if (scroll === null) throw new Error("library scroll not found");
            scroll.scrollTop =
              where === "top" ? 0 : (scroll.scrollHeight - scroll.clientHeight) / 2;
          }, position);
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const cpu = cpuSeconds();
          const frames = await page.evaluate(
            async ({ where, viewMode }) => {
              const scroll = document.querySelector("[data-library-scroll]");
              if (scroll === null) throw new Error("library scroll not found");
              const bounds = scroll.getBoundingClientRect();
              const visible = [...document.querySelectorAll("[data-series-root]")].filter(
                (root) => {
                  const rect = root.getBoundingClientRect();
                  return rect.bottom > bounds.top && rect.top < bounds.bottom;
                },
              );
              const middleCandidates = visible.filter((root) => {
                const rect = root.getBoundingClientRect();
                const column = root.parentElement
                  ? [...root.parentElement.children].indexOf(root)
                  : -1;
                return (
                  rect.bottom <= bounds.bottom &&
                  rect.top <= bounds.top + bounds.height * 0.3 &&
                  (viewMode !== "grid" || column === 0)
                );
              });
              const root =
                where === "top"
                  ? visible[0]
                  : (middleCandidates[0] ?? visible[Math.floor(visible.length / 2)]);
              const seriesId = root?.getAttribute("data-series-root");
              if (seriesId === null || seriesId === undefined) {
                throw new Error(`no visible series at ${where}`);
              }
              const findRoot = () =>
                [...document.querySelectorAll("[data-series-root]")].find(
                  (candidate) => candidate.getAttribute("data-series-root") === seriesId,
                );
              const waitFor = async (expanded) => {
                const deadline = performance.now() + 10000;
                while (performance.now() < deadline) {
                  const toggle = findRoot()?.querySelector("[data-series-toggle]");
                  const transitioning =
                    document
                      .querySelector("main[data-series-transitioning]")
                      ?.getAttribute("data-series-transitioning") === "true";
                  if (
                    toggle?.getAttribute("aria-expanded") === String(expanded) &&
                    !transitioning
                  ) {
                    return;
                  }
                  await new Promise((resolve) => requestAnimationFrame(resolve));
                }
                throw new Error("series motion timed out");
              };

              window.__startSampler();
              for (let cycle = 0; cycle < 10; cycle += 1) {
                const toggle = findRoot()?.querySelector("[data-series-toggle]");
                if (toggle === null || toggle === undefined)
                  throw new Error("series toggle missing");
                toggle.click();
                await waitFor(true);
                const expanded = findRoot()?.querySelector("[data-series-toggle]");
                if (expanded === null || expanded === undefined) {
                  throw new Error("expanded series toggle missing");
                }
                expanded.click();
                await waitFor(false);
              }
              return window.__stopSampler();
            },
            { where: position, viewMode: view },
          );
          const cpuS = Math.round((cpuSeconds() - cpu) * 100) / 100;
          result.series.runs.push({ view, position, cpuS, frames });
          log("series", view, position, "CPU", cpuS, "s; frames", JSON.stringify(frames));
        }
      }
    }
  } catch (error) {
    result.error = String(error).slice(0, 300);
    log("failed:", result.error);
  }

  await context.close();
  mkdirSync(join(benchDir, "results"), { recursive: true });
  writeFileSync(
    join(benchDir, "results", `${label}-${layoutName}.json`),
    JSON.stringify(result, null, 2),
  );
}

for (const [name, layout] of Object.entries(layouts)) await run(name, layout);
server.close();
