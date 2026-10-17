# Reader Hero

An offline-first PDF and EPUB reader for the browser. It parses a PDF's text layer, or an EPUB's
chapters, and reflows them into an e-book-style reader, mobile-first. A PDF also opens as its
original pages. Everything runs on the client: no server holds a document, and the app works
with no network once installed.

## Stack

- React + Vite, react-router, Tailwind v4 + daisyUI v5
- Effect v4 for all side effects, services, and schema
- pdf.js for text extraction, page rendering, and the original view's text layer
- fflate for EPUB archives, and @tanstack/react-virtual for the original view's page list
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
| `npm test`                                | Run the unit tests. `npm run test:watch` runs them on each change.         |
| `npm run lint`                            | ESLint, then the word check in `scripts/check-words.mjs`.                  |
| `npm run format`                          | Prettier over the repo.                                                    |
| `npm run deploy:dev`                      | Build, then `sst deploy --stage dev` to `reader-hero-dev.mwyndham.dev`.    |
| `npm run deploy:prod`                     | Build, then `sst deploy --stage production`.                               |
| `npm run icons`                           | Regenerate the PWA icons from `scripts/make-icons.mjs`.                    |
| `npm run licences`                        | Write `src/domain/licences.ts` from the dependencies' licence files.       |
| `npm run review -- [--base <ref>]`        | Have `opencode` review the diff against a commit (`--model` picks one).    |
| `npm run bench -- <label>`                | Benchmark the built app in Playwright's WebKit, desktop and mobile layout. |
| `npm run bench:compare -- <a> <b>`        | Print two benchmark runs side by side.                                     |
| `npm run bench:probe -- <label> [mobile]` | Measure only the original view's scroll. `SAMPLE=1` samples the process.   |
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

## What must stay true

- **100% client-side.** The worker serves files and the relay below. No document, text, or
  progress goes off the device, except to the AI provider the reader set up with their own key.
  Every such request needs consent to the current consent text (`CONSENT_VERSION`), which the
  consent note asks for and which names each kind below. `AiClient` checks it again before any
  request goes out, against the saved settings: the same provider, key and base URL, or nothing
  is sent. Removing the key, or saving another provider, key or base URL, stops every running job.
  The requests:
  - The summary sends the book's text, one chapter per request with the summary of the chapter
    before, only on a tap or with Automatic summary switched on. Updating the character list
    sends the chapter summaries and the names the reader added or removed. The current
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
    `src/worker/relay.ts`. The rest go straight from the device. The relay answers only the
    app's own pages (by `Sec-Fetch-Site` or `Origin`), reaches a fixed list of hosts on the
    default port, passes on only chat and model-list calls, streams each body through, and
    logs, stores and reads nothing. The service worker never caches `/relay`. A dialog says so
    when the reader picks a relayed provider.
- **Effect owns side effects.** Parsing, storage, and rendering pages return `Effect`s at the
  service boundary. The Web Workers and the service worker are plain promise code behind it.
  React components render state and handle interaction. They never import pdf.js or
  IndexedDB directly. Services are reached through the runtime hook in `src/lib/hooks.ts`.
- **Schema at the boundary.** Stored records, shared files and service-worker messages are
  decoded with `effect/Schema`. A stored record that fails to decode never breaks
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
scenario, next to the longest pauses between frames. Compare a change against the commit before it: build,
`npm run bench -- before`, apply the change, build, `npm run bench -- after`, then
`npm run bench:compare -- before after`. Results land in `.bench/results`, which git ignores.

## Local development

`npm run dev` binds every interface so a phone on the tailnet can open the plain
IP. A service worker cannot register on a plain IP (not a secure context), so
develop and read on the IP, and test install/offline on the dev deployment. The
dev server answers `/relay` with the Worker's own relay code, through a plugin in
`vite.config.ts`.

# Rules

These rules govern every change. When a rule makes the code worse, keep the better code and give
the reason in the commit message. Never drop a rule silently.

## 1. Write for the reader.

Judge code by how long another person needs to understand it. A short line that needs a second
read is worse than a longer line that does not. A reader holds about four things in mind at once.
Keep each block within that.

This rule settles every tie between the rules below.

## 2. Use plain words.

This covers docs, commit messages, comments, UI text and identifiers. `npm run lint` checks the
words it can. A person checks the rest.

1. Never use these words or their other forms: `bail`, `absent`, `clearing`, `no-op`,
   `falls through`, `survives`, `lands`, `leaves`, `read better`, `invariant`, `gap`,
   `sits` (for placement), `minted`, `guard`, `adds`, `call site`, `gate`, `cut` (for a branch),
   `shape`, `spike`, and the opener `Worth ...ing?`.
2. Never use these metaphors: `load-bearing`, `frozen`, `seam`, `surface` (as a noun),
   `carries the weight`, `outranks`, `the heart of the change`, `honest` or `lie` (about code),
   `earns its place`, `holds the contract`.
3. No em dashes, no en dashes and no semicolons in prose. Never write a short label, then a colon,
   then its explanation. A colon only opens a list or an example.
4. No words that claim weight instead of stating a fact: `critically`, `significantly`,
   `the key insight`, `this is important`, `make no mistake`.
5. In docs and commit messages, never join two facts with `because`, `therefore` or `hence`.
   Write two plain sentences.
6. One fact per sentence. Never join two facts with a comma and `and`, as in "I did X, and Y
   happened". Write two sentences.
7. Name a thing by what it does: `isMissing`, never `isAbsent`. `isSiteEnabled`, never `siteGate`.
8. Read each sentence aloud. If a person explaining the thing to a teammate would not say it that
   way, write it again.

"Add" as a button label or an action name, such as "Add book" and `addBook`, is allowed.

## 3. A comment says what a name cannot.

Code explains itself. A comment is the exception, not the habit.

Most comments are not needed. Delete one unless it gives a reason the code cannot: why the code
does something a reader would not expect, the source of a formula with the source's own symbol, or
the unit of a bare number. If a line needs a comment to say what it does, rename the line or split
it.

A comment is one line and gives one reason. Never write a banner, an ALL-CAPS label, step
narration such as `// Step 1`, a label such as `// Main logic`, prose inside a JSDoc block,
commented-out code, or a TODO with no named task. TypeScript types carry the contract, so a JSDoc
block holds types only.

A comment stands alone. A reader who knows the code but not its history must understand it. Never
refer to a past version, a change, the state of the codebase when the comment was written, or the
code around it. Words such as `no longer`, `used to`, `previously`, `older build`, `this change`,
`still`, `now` or `the line above` are not reasons.

`npm run lint` checks the length and the words it can. A term a reader may not know, such as
`linearize`, gets a link or a plain word on the same line.

## 4. A name is a full word.

- Write full words. `errorCount`, never `nErr`. A long name is fine.
- A boolean reads as a question: `isRendering`, `hasTextLayer`.
- A function is an action and its subject: `renderPage`, `parseEpub`.
- Use `min` and `max` for limits. Use `first` and `last` for a range that includes both ends.
- One thing has one name everywhere. The code, the store and the UI all say "book" and "page".
  A name the platform or a library owns keeps its spelling.

## 5. A number carries its unit.

- Put the unit in the name: `timeoutMs`, `pageWidthPx`, `fontSizePt`, `sizeBytes`, `scale`,
  `ratio`. A value with no unit keeps its plain name, such as `q` or `pageCount`.
- A unit mismatch then looks wrong on sight: `widthPx = widthPt`.
- Give a number a local name when a reader cannot tell what it is from its line. `Math.max(1, x)`
  needs no name. `setTimeout(fn, 150)` does, as `const settleMs = 150` beside the call.
- Put parentheses around mixed operators when the order is not obvious.

## 6. Structure.

- Return early. The main path comes last. Keep each `if` one level deep where you can.
- Check a value once, where it enters: a storage read, a parsed book, a worker message, a field the
  user typed in. Code past that point trusts the value.
- A blank line groups a block. One idea per block, about five statements.
- Control flow is its own block. An `if`, a loop, a `switch` or a `try` of more than one line has a
  blank line before and after it, unless it opens or closes its block. A one-line one needs none.
  A run of early exits, or of one-line `if` statements, stays together.
- Declare, then use. A run of declarations has a blank line between it and the statements around it.
- Inside a run of declarations, the inputs come first, then the values worked out from them, then
  what is built from those, each with a blank line between.
- A function of more than three lines keeps a blank line before its last return.
- Name a compound condition before you test it: `const canDraw = hasSize && isVisible`.
- A ternary fits on one line. Never nest one.
- Build a list with `if` and `push`. Never `[a && x, b && y].filter(Boolean)`.
- Name a lookup table above the line that indexes it.
- Keep a function to 15 branch points or fewer. Count `if`, `else if`, `for`, `while`, `case`,
  `catch`, a ternary, `&&`, `||` and `??`.
- Use `startsWith`, `indexOf`, `slice` and `split` before regex.

## 7. Functions, constants and files.

- When two or more places do the same work, pull it into one function. Two copies drift apart.
- A function inside a function that is called twice moves to the top level, with its inputs as
  parameters. A hook keeps the state its methods share.
- A one-line body counts when two copies could disagree, such as a formula, a selector or a rule
  about when something is off. A plain call with a new name does not count.
- Write a named constant or a shared type when two or more places use it.
- Before you write a new file or helper, ask one question. If you deleted it and put its code back
  where it is used, would the code be harder to follow? If not, do not write it.
- Each formula is a named function, even when one place uses it, as `clamp` is. `20 * Math.log10(x)`
  is `linearToDb(x)`.
- Code that two contexts both need goes in one shared place. Do not copy a worker helper into the
  app.
- A function that runs past about 80 lines is two functions. Split by what the reader needs at
  one time, not by line count.
- A function name's verb says what it does. A name that makes the reader look at the body is wrong.

## 8. Tests state the situation and the result.

- A test name says what is given and what happens: `given a page with two columns, reads the left
column first`.
- Test what a reader sees, hears or stores. A pure function earns a test of its own when the
  pipeline would hide its failure.
- Break the code on purpose and watch the test fail before you keep it.
- Use the real pipeline where you can. A stub stands in for a service boundary, not for the logic
  under test.

## 9. Scope of a change.

- Touch only what the task needs. Match the style already in the file. Do not tidy nearby code.
- Fewer lines wins a tie. A named value that saves the reader time stays, even when it costs a line.
- Run the formatter only on the files you changed.

## 10. JSDoc gives types and nothing else.

- TypeScript types carry the contract, so a JSDoc block is not used. A reason goes in one `//` line
  above the function, under rule 3.
- A type that two or more places use is a named `type` or `interface` in the file that owns it.

## Accepted exceptions

Each one names the rule it breaks and the reason. `scripts/check-structure.mjs` keeps the branch
count of each at or below the number it has today, so none can grow.

- The node walk inside `parseEpub` in `src/lib/epub/parse.ts` has 72 branch points, against rule 6.
  It shares one block buffer, one mark list and one page state with every element case. A split
  would pass that whole context through each call.
- `buildShelf` in `src/lib/shelf.ts` has 64 branch points, against rule 6. It derives one shelf in
  stages, and each stage reads the lead and series maps the one before it wrote.
- `SummarySheet` has 35 branch points, against rule 6. Its JSX branches all test the one sheet's
  state, and the sections share its refs and callbacks.
- `LibraryRoute` has 28 branch points, against rule 6. It is one route's toolbar, grid and sheets.

## What the check enforces

`npm run lint` runs `scripts/check-words.mjs` and `scripts/check-structure.mjs` after ESLint.

`check-words.mjs` checks rules 2 and 3 where a machine can: banned words, dashes and semicolons in
prose, and a comment over one line. `check-structure.mjs` checks rule 6 where a machine can: the
15-branch limit, the blank line before a last return, the blank lines around multi-line control
flow, and a run of declarations set apart from the statements around it. A generated file and a
dependency's own text are not checked. The rest needs a person.
