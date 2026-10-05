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

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on all interfaces (`http://<tailscale-ip>:5173`). |
| `npm run build` | Build the SPA to `dist/client` and the service worker. |
| `npm run dev:worker` | Serve `dist/client` through the Hono worker with `wrangler dev`. |
| `npm run typecheck` | Typecheck the app, worker, service worker, and configs. |
| `npm test` | Run the PDF pipeline tests. |
| `npm run lint` | ESLint. |
| `npm run deploy:dev` | Build, then `sst deploy --stage dev` to `pdf-hero-dev.mwyndham.dev`. |
| `npm run icons` | Regenerate the PWA icons from `scripts/make-icons.mjs`. |

## Layout

```
src/
  domain/        Schema models (book, settings) and tagged errors
  services/      Effect services: BookStore, PdfClient, SettingsStore
  use-cases/     Orchestration: import, parse, inbox
  lib/pdf/       The reflow pipeline: lines, columns, blocks, boilerplate, assemble
  lib/           Runtime hooks, IndexedDB, codecs, formatting
  routes/        library/ and reader/, each a directory with its own components
  worker/        Hono worker
  sw.ts          Service worker: precache, offline navigation, share target
  runtime.ts     The single ManagedRuntime
```

## Invariants

- **100% client-side.** The worker only serves files. No document, text, or
  progress leaves the device.
- **Effect owns side effects.** Parsing, storage, and rendering pages return
  `Effect`s. React components render state and handle interaction; they never
  import pdf.js or IndexedDB directly. Services are reached through the runtime
  hook in `src/lib/hooks.ts`.
- **Schema at the boundary.** Stored records and service-worker messages are
  validated with `effect/Schema`. A record from an older build that fails to
  decode triggers a re-parse instead of breaking the reader.
- **One runtime.** `src/runtime.ts` builds one `ManagedRuntime` from the app's
  layers. Never create another.

## Local development

`npm run dev` binds every interface so a phone on the tailnet can open the plain
IP. A service worker cannot register on a plain IP (not a secure context), so
develop and read on the IP, and test install/offline on the dev deployment.
