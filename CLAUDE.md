# Reader Hero

An offline-first PDF reader for the browser. It parses a PDF's text layer and
reflows it into an e-book-style reader, mobile-first. Everything runs on the
client: no server holds a document, and the app works with no network once
installed.

## Stack

- React + Vite, Tailwind v4 + daisyUI v5
- Effect v4 for all side effects, services, and schema
- pdf.js for text extraction and page rendering
- IndexedDB (via `idb`) for documents, parsed text, and progress
- Hono on a Cloudflare Worker serving the built assets
- SST for local dev and deploy

## Commands

| Command                                   | What it does                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                             | Vite dev server on all interfaces (`http://<tailscale-ip>:5173`).          |
| `npm run build`                           | Build the SPA to `dist/client` and the service worker.                     |
| `npm run dev:worker`                      | Serve `dist/client` through the Hono worker with `wrangler dev`.           |
| `npm run typecheck`                       | Typecheck the app, worker, service worker, and configs.                    |
| `npm test`                                | Run the PDF pipeline tests.                                                |
| `npm run lint`                            | ESLint.                                                                    |
| `npm run deploy:dev`                      | Build, then `sst deploy --stage dev` to `reader-hero-dev.mwyndham.dev`.    |
| `npm run icons`                           | Regenerate the PWA icons from `scripts/make-icons.mjs`.                    |
| `npm run bench -- <label>`                | Benchmark the built app in Playwright's WebKit, desktop and mobile layout. |
| `npm run bench:compare -- <a> <b>`        | Print two benchmark runs side by side.                                     |
| `npm run bench:probe -- <label> [mobile]` | Measure only the original view's scroll, with sampling options.            |
| `npm run bench:serve`                     | Serve `dist/client` on port 4173 for a manual check in Safari.             |

## Layout

```
src/
  domain/        Schema models (book, settings, ai) and tagged errors
  services/      Effect services: BookStore, PdfClient, SettingsStore, ArtifactStore, AiClient,
                 SummaryJobs (the summary fibers, one per book, outliving the reader)
  use-cases/     Orchestration: import, parse, inbox, recap, the summary job, their context builder
  lib/pdf/       The reflow pipeline: lines, columns, blocks, boilerplate, assemble
  lib/           Runtime hooks, IndexedDB, codecs, formatting, the AI transport and its
                 event stream parser (a lazy chunk, loaded on the first AI action)
  routes/        library/ and reader/, each a directory with its own components
  worker/        Hono worker
  sw.ts          Service worker: precache, offline navigation, share target
  runtime.ts     The single ManagedRuntime
```

## Invariants

- **100% client-side.** The worker only serves files. No document, text, or
  progress leaves the device. The one exception is an AI action the reader
  taps: it sends the chosen passage straight to the provider the reader set up
  with their own key, never through the worker, and only after a consent sheet.
- **Effect owns side effects.** Parsing, storage, and rendering pages return
  `Effect`s. React components render state and handle interaction; they never
  import pdf.js or IndexedDB directly. Services are reached through the runtime
  hook in `src/lib/hooks.ts`.
- **Schema at the boundary.** Stored records and service-worker messages are
  validated with `effect/Schema`. A record from an older build that fails to
  decode triggers a re-parse instead of breaking the reader.
- **One runtime.** `src/runtime.ts` builds one `ManagedRuntime` from the app's
  layers. Never create another.

## Benchmark

`scripts/bench` measures a build in Playwright's WebKit, the engine behind Safari. Run
`npx playwright install webkit` once. Each run uses a fresh profile per layout and measures:
launch on a slow network and offline, import and the figure job, reader open, reader
scrolling, and the original view. Safari cannot throttle its CPU, so the work-done metric is
the content process's CPU seconds per scenario, next to frame gaps. Compare a change against
the commit before it: build, `npm run bench -- before`, apply the change, build,
`npm run bench -- after`, then `npm run bench:compare -- before after`. Results land in
`.bench/results`, which git ignores.

## Local development

`npm run dev` binds every interface so a phone on the tailnet can open the plain
IP. A service worker cannot register on a plain IP (not a secure context), so
develop and read on the IP, and test install/offline on the dev deployment.
