# Reader Hero

An offline-first PDF and EPUB reader for the browser. It parses a PDF's text layer, or an EPUB's
chapters, and reflows them into an e-book-style reader, mobile-first; a PDF also opens as its
original pages. Everything runs on the client: no server holds a document, and the app works
with no network once installed.

## Stack

- React + Vite, react-router, Tailwind v4 + daisyUI v5
- Effect v4 for all side effects, services, and schema
- pdf.js for text extraction, page rendering, and the original view's text layer
- fflate for EPUB archives; @tanstack/react-virtual for the original view's page list
- IndexedDB (via `idb`) for books, files, parsed text, images, progress, prefs, settings,
  summaries, series, and shared files waiting to import
- Hono on a Cloudflare Worker serving the built assets
- SST for local dev and deploy

## Commands

| Command                                   | What it does                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                             | Vite dev server on all interfaces (`http://<tailscale-ip>:5173`).          |
| `npm run build`                           | Build the SPA to `dist/client` and the service worker.                     |
| `npm run preview`                         | Serve the build with Vite on all interfaces.                               |
| `npm run dev:worker`                      | Serve `dist/client` through the Hono worker with `wrangler dev`.           |
| `npm run typecheck`                       | Typecheck the app, workers, service worker, and configs.                   |
| `npm test`                                | Run the unit tests; `npm run test:watch` runs them on each change.         |
| `npm run lint`                            | ESLint.                                                                    |
| `npm run format`                          | Prettier over the repo.                                                    |
| `npm run deploy:dev`                      | Build, then `sst deploy --stage dev` to `reader-hero-dev.mwyndham.dev`.    |
| `npm run deploy:prod`                     | Build, then `sst deploy --stage production`.                               |
| `npm run icons`                           | Regenerate the PWA icons from `scripts/make-icons.mjs`.                    |
| `npm run licences`                        | Write `src/domain/licences.ts` from the dependencies' licence files.       |
| `npm run review -- [--base <ref>]`        | Have `opencode` review the diff against a commit (`--model` picks one).    |
| `npm run bench -- <label>`                | Benchmark the built app in Playwright's WebKit, desktop and mobile layout. |
| `npm run bench:compare -- <a> <b>`        | Print two benchmark runs side by side.                                     |
| `npm run bench:probe -- <label> [mobile]` | Measure only the original view's scroll; `SAMPLE=1` samples the process.   |
| `npm run bench:serve`                     | Serve `dist/client` on port 4173 for a manual check in Safari.             |

## Layout

```
src/
  domain/        Schema models (book, which holds the reader settings, and ai), tagged errors,
                 service-worker messages, and the generated licences
  services/      Effect services: BookStore, PdfClient, PageRenderer (the original view's render
                 worker), SettingsStore, SummaryStore, AiClient, ServiceWorkerClient, FigureSlots,
                 FigureJobs (one figure job per book, held by each screen that shows the book, so a
                 removal can stop it), and SummaryJobs (one summary fiber per book, which runs on
                 after the reader closes, one series summary fiber per series, which holds its
                 earlier volumes, and one rebuild of every later volume's character list, which
                 holds those volumes)
  use-cases/     Orchestration: import (PDF, EPUB, shared files), parse and rebuild, the figure
                 job, the original view's pages, links, text layer and search, the summary job
                 and its chapter list, series and their grouping, removal, progress and prefs
  lib/pdf/       The reflow pipeline: lines, columns, blocks, boilerplate, assemble
  lib/epub/      The EPUB reader: container, package, spine, and chapters to blocks
  lib/           Runtime hooks, IndexedDB, codecs, formatting, search, gestures, the AI transport
                 and its event stream parser (a lazy chunk, loaded on the first AI action)
  workers/       Web Workers: pdf-render (the original view's pages, links, text and search, on
                 its own pdf.js document) and encode-image (figures to JPEG)
  routes/        library/ and reader/, each a directory with its own components
  components/    Shared components: icons, tour art, theme controls, the update toast
  styles/        The app's CSS and the original view's text layer rules from pdf.js
  worker/        Hono worker and the relay
  sw.ts          Service worker: precache, offline navigation, share target
  runtime.ts     The single ManagedRuntime
```

## Invariants

- **100% client-side.** The worker serves files and the relay below. No document, text, or
  progress leaves the device, except to the AI provider the reader set up with their own key.
  Every such request needs consent to the current consent text (`CONSENT_VERSION`), which the
  consent note asks for and which names each kind below. `AiClient` checks it again before any
  request leaves, against the saved settings: the same provider, key and base URL, or nothing is
  sent. Removing the key, or saving another provider, key or base URL, stops every running job.
  The requests:
  - The summary sends the book's text, one chapter per request with the summary of the chapter
    before, only on a tap or with Automatic summary switched on. Updating the character list
    sends the chapter summaries and the names the reader added or removed; the current
    position sends the part of the chapter read so far.
  - A question in the Summary sheet sends the summaries, the character list and the thread.
  - Series grouping sends the title, author, file name and first 200 words of each new book,
    only with Series grouping switched on. Each book goes once: it counts as sent once the
    provider answers. The request also lists the names and book titles of the series that
    exist for the batch's authors. Reset grouping, in Settings, sends every book again.
  - The series summary sends the stored summaries of the series' started volumes, one volume
    per request, on a tap of Summarise or with Automatic summary on. It first sends the chapters
    of those volumes that have no summary yet, as the summary does.
  - The character list of a later volume also sends the characters from the stored summaries
    of earlier volumes, at most 60, with each request that updates the list.
  - Rebuild, in Settings, writes every summary again: it sends the chapters of each started
    book that has a summary or is in a series, then its names, position and series paragraph,
    only on a tap.
  - Providers that refuse browser requests (Groq, Cerebras, Z.ai, both OpenCode services,
    NVIDIA, Mistral, Together, and the OpenAI-compatible provider) go through `/relay` in
    `src/worker/relay.ts`; the rest go straight from the device. The relay answers only the
    app's own pages (by `Sec-Fetch-Site` or `Origin`), reaches a fixed list of hosts on the
    default port, passes on only chat and model-list calls, streams each body through, and
    logs, stores and reads nothing. The service worker never caches `/relay`. A dialog says so
    when the reader picks a relayed provider.
- **Effect owns side effects.** Parsing, storage, and rendering pages return `Effect`s at the
  service boundary; the Web Workers and the service worker are plain promise code behind it.
  React components render state and handle interaction; they never import pdf.js or
  IndexedDB directly. Services are reached through the runtime hook in `src/lib/hooks.ts`.
- **Schema at the boundary.** Stored records, shared files and service-worker messages are
  decoded with `effect/Schema`. A record from an older build that fails to decode never breaks
  the app: a book record drops out of the list, a parsed book is rebuilt when it opens,
  settings fall back to their defaults, and summaries and series to none.
- **One runtime.** `src/runtime.ts` builds one `ManagedRuntime` from the app's
  layers. Never create another.

## Benchmark

`scripts/bench` measures a build in Playwright's WebKit, the engine behind Safari. Run
`npx playwright install webkit` once. Each run uses a fresh profile per layout and measures:
launch on a slow network and offline, import and the figure job, reader open, reader
scrolling, the original view, and, in the mobile layout, the series library's scroll. Safari
cannot throttle its CPU, so the work-done metric is the content process's CPU seconds per
scenario, next to frame gaps. Compare a change against the commit before it: build,
`npm run bench -- before`, apply the change, build, `npm run bench -- after`, then
`npm run bench:compare -- before after`. Results land in `.bench/results`, which git ignores.

## Local development

`npm run dev` binds every interface so a phone on the tailnet can open the plain
IP. A service worker cannot register on a plain IP (not a secure context), so
develop and read on the IP, and test install/offline on the dev deployment. The
dev server answers `/relay` with the Worker's own relay code, through a plugin in
`vite.config.ts`.
