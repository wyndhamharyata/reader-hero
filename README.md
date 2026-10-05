# Reader Hero

An offline-first PDF reader for the browser. It extracts a PDF's text layer and
reflows it into an e-book-style reader built for a phone screen: adjustable
font, theme, and spacing, a table of contents, saved reading position, and a
one-tap fall back to the original page.

Everything runs on the client. The worker serves files; it never sees a
document. Once installed, the app works with no network.

## Requirements

- Node 22.12 or newer.
- A Cloudflare account that owns the `mwyndham.dev` zone (for the dev deploy).
- The `mwyndham.dev` zone already added to that account.

## Setup

```sh
npm install
cp .env.example .env
# set CLOUDFLARE_DEFAULT_ACCOUNT_ID in .env
```

## Local development

```sh
npm run dev
```

Vite serves on every interface. On the same tailnet, open
`http://<tailscale-ip>:5173` on the phone. A service worker cannot register on a
plain IP, so use the dev deployment to test install and offline behavior.

To serve the built app through the real worker locally:

```sh
npm run build
npm run dev:worker
```

## Deploy

```sh
npm run deploy:dev
```

Builds the SPA, then deploys the worker to `https://pdf-hero-dev.mwyndham.dev`.
Production is the same command with `--stage production`
(`npm run deploy:prod`), which targets `https://pdf-hero.mwyndham.dev`.

## Installing as an app

Open the dev URL in Chrome or Safari and choose "Add to Home Screen". On iOS,
open the app once and import a PDF; the app then asks the browser for persistent
storage so iOS does not evict your library.

On Android, a PDF shared from Files or a browser offers "Reader Hero" as a share
target. The service worker stores the shared file and the app imports it on
open.

## Tests

```sh
npm test
```

The tests drive the reflow heuristics — line building, column order, paragraph
merging, heading detection, boilerplate removal, and assembly — with synthetic
pdf.js text items.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the module layout and the invariants that hold
across the codebase.
