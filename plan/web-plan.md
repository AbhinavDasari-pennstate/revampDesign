# Tester web app plan (WEB-PLAN, written Wed Nov 11 2026)

Status: PROPOSED, waiting for Abhinav's approval. Decisions it builds on: plan/decisions.md lines 21 to 24 (tester web app, local first, invite codes plus caps, free mode by default). Task format: plan/plan.md. Lane rule: plan/lanes.md ("no one touches another person's work"). Times are PST.

## 1. PRD

**Who.** An invited tester: a school office or small organisation owner Abhinav hands an invite code to. Non-technical. They own (or have the owner's permission for) the site they enter. Operator: Abhinav, on his laptop.

**The one flow that must work.**
1. The tester opens `http://127.0.0.1:8787/` (local first; later a host), enters the invite code, their site URL, the owner's name, and ticks the required consent box.
2. The app queues the run (one run at a time; the rest wait with a visible position) and starts `node orchestrator/cli.mjs run --url <u> --tier B --consent-note <text> --out-dir <job dir>`, adding `--live` only when Abhinav flipped the admin switch for that job.
3. The tester watches stage progress live (queued, scout, story, art, council, select, build).
4. When it finishes, the tester views, in the browser: the redesigned site (sandboxed), the plain-language report (`c-build/report.md`, rendered as text, never as markup), the three-direction compare page (`b-design/compare.html`, sandboxed) and the page screenshots. They can download the built site.

**Out of scope (v1).** Accounts, passwords, billing, email delivery of codes, editing the redesign, choosing tier or direction (tier B and the council pick are fixed), cancelling a run, more than one concurrent run, any change to a lane's pipeline code or to `orchestrator/`, deploying (T50, separately approved), any new dependency.

**Success metric.** An outside tester (not on the team) completes a free run on their own site from an invite code and opens the redesign without help. Measured in T49: Abhinav watches without speaking; pass means the redesign opens and the tester reaches the report with zero help requests.

**Safety rules the code must enforce.**
- Built output and compare pages came from a scraped site: they are served only by the viewer (separate origin, port 8788), each response with `Content-Security-Policy: sandbox allow-scripts` plus `connect-src 'none'`, `form-action 'none'`, `frame-ancestors` limited to the app origin, `X-Content-Type-Options: nosniff`, and shown in the app inside `<iframe sandbox="allow-scripts">` (never `allow-same-origin`, `allow-top-navigation` or `allow-forms`).
- Scraped text (report, titles, error text) is only ever set with `textContent` or `createTextNode`. A test fails the build on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `DOMParser` anywhere in `web/ui/`.
- The app sets no cookies and stores no secret in the browser, because two ports on 127.0.0.1 share cookies; port separation is enough locally only. Deploy (T50) needs the viewer on a different registrable domain.
- The server binds 127.0.0.1 only, refuses non-public target hosts (loopback, private, link-local, CGNAT, unique-local IPv6) after a DNS lookup, and spawns the orchestrator with an argument array (`shell: false`), never a command string.
- Invite codes are stored only as SHA-256 hashes in `web-data/invites.json` (gitignored); the plain code is printed once when created and never logged.
- A run where any stage fell back to the sample fixture (`STUB ... (lane not present)` in the orchestrator output) is shown as failed ("this run could not build a real redesign"), never as the tester's result, so a tester never sees Maple Grove as their site.

## 2. HTTP API contract v1 (summary; the schemas in `contracts/web/` are the truth, frozen at tag `contracts-web-v1.0.0` by T39)

App server, origin `http://127.0.0.1:8787` (Abhinav):

| Route | Request | Response |
|---|---|---|
| `GET /` and `/ui/*` | none | static files from `web/ui/` (read as files, never executed by the server) |
| `POST /api/jobs` | `start-request.v1`: `{invite_code, url, owner_name, consent: true}` | `202 job.v1` (status `queued`, `position`) or `4xx/503 error.v1` |
| `GET /api/jobs/:job_id` | none | `200 job.v1` or `404 error.v1` |
| `GET /api/jobs/:job_id/events` | `Last-Event-ID` optional | `text/event-stream` of `event.v1`, full history replayed on connect, `: ping` every 15 s, closes after `done` or `failed` |

- `job.v1`: `job_id` (22 char base64url, random 128 bit, never the invite code), `status` (queued, running, done, failed), `position` (int or null), `mode` (free, live), `stages[] {stage, state}` with stage in scout, story, art, council, select, build and state in pending, running, done, failed; `created_at`, `started_at`, `finished_at`; `error {code, message}` or null; `manifest_url` (viewer URL, set only when `done`).
- `event.v1` (SSE `event:` name plus JSON `data:`, increasing `id:`): `queued {position}`, `started {mode}`, `stage {stage, state}`, `done {manifest_url}`, `failed {code, message}`.
- `error.v1`: `{error: {code, message}}`. Codes: `bad_request`, `bad_url`, `host_not_public`, `owner_name_required`, `consent_required`, `invite_invalid`, `invite_used_today`, `daily_cap_reached`, `queue_full`, `not_found`. Run failure codes (in `job.v1.error` and `failed` events): `site_blocked` (exit 3 at scout), `quality_gate` (exit 3 later), `budget` (exit 4), `not_real` (a stub fallback), `timeout`, `crash`, `server_restarted`. `message` is fixed plain-language text from the contract, never scraped text and never a stack trace.

Viewer, origin `http://127.0.0.1:8788` (Aditya), read-only over the job folders:

| Route | Serves |
|---|---|
| `GET /j/:job_id/manifest.json` | `manifest.v1` (CORS allowed for the app origin only) |
| `GET /j/:job_id/run/<path>` | a file from the job's run folder, only under `c-build/site/dist/`, `c-build/screens/`, `b-design/compare.html`, `b-design/previews/`, `b-design/boards/`; everything else 404 (no contract JSON, no `a-scout/`, no logs, no listings) |
| `GET /j/:job_id/report.md` | `c-build/report.md` as `text/plain; charset=utf-8`, CORS for the app origin |
| `GET /j/:job_id/bundle.tar.gz` | the built site as a download (T48) |

- `manifest.v1`: `job_id`, `site {home_url, pages[] {slug, url, screenshots {desktop, mobile}}}`, `compare_url`, `report_url`, `bundle_url` (or null), `gates {passed, axe_serious, axe_critical}`, `fidelity {pages_carried, pages_total}`; all built from `50-handoff.json` and `40-verdict.json` of that run. Served only when `50-handoff.json` exists.

Fixtures (T39, `contracts/web/fixtures/`): one valid request, one response per status, one `error.v1` per code, `manifest.json` that points at the existing `contracts/fixtures/sample/` run, and three SSE streams: `events-done.sse`, `events-failed.sse`, `events-queued.sse` (hand-written in T39, then re-recorded from the real server in T43, which must still match after normalising ids and times).

## 3. Folders and owners

| Folder | Owner | Branch prefix | Holds |
|---|---|---|---|
| `contracts/web/` | Abhinav | `lane-a/` | schemas, fixtures, README for the HTTP API |
| `web/server/` | Abhinav | `lane-a/` | `server.mjs`, `queue.mjs`, `progress.mjs`, `invites.mjs`, `admin.mjs`, `urlcheck.mjs`, `test/`, `CLAUDE.md` |
| `web/ui/` | Nirmal | `lane-b/` | `index.html`, `job.html`, `css/`, `js/`, `dev/mock-server.mjs`, `test/`, `CLAUDE.md` |
| `web/viewer/` | Aditya | `lane-c/` | `server.mjs`, `manifest.mjs`, `bundle.mjs`, `test/`, `test/fixtures/hostile-run/`, `CLAUDE.md` |
| `web-data/` | runtime only | none | gitignored: `invites.json`, `jobs/<job_id>/` (job.json, console.log, live.flag, the orchestrator's run folder), `spend.json` |

Changes in Abhinav's files (T39): `.github/CODEOWNERS` adds `/web/ui/ @Nirmal-28` and `/web/viewer/ @adithya916`; `.github/scripts/lane-guard.mjs` lets `lane-b/` touch `lanes/b-design/` or `web/ui/`, `lane-c/` touch `lanes/c-build/` or `web/viewer/`, and blocks `lane-a/` from both new folders; `.gitignore` adds `web-data/`; `.github/workflows/ci.yml` adds one job per new folder (`cd web/<x> && node --test`, plus `contracts` tests for `contracts/web/`).

Who runs whose code: only Abhinav's server runs other code (the orchestrator, and the viewer as a child process), the same rule the orchestrator follows today. Nirmal and Aditya build and test only against `contracts/web/fixtures/` and `contracts/fixtures/sample/`, never against each other's folders or the live server. No `package.json` dependencies in `web/`; every file is Node 22+ stdlib or plain browser JS.

Hours: Abhinav about 7 (he writes the contract and the server nobody else can, and works with Claude full time, the same reasoning as plan/lanes.md), Nirmal about 4.5, Aditya about 4.

## 4. Tasks

Demo path first: T39 freezes the contract so all three lanes start the same day; T40 and T43 give a working run behind the API; T41, T44, T46 and T42, T45 build against fixtures in parallel; T47 adds access control; T49 is the outside-tester check. Every task: one builder session, failing test first, `node --test` in its own folder.

### T39: Web API contract v1 and lane setup
owner: Abhinav | lane: A | depends_on: [] | estimate: 90 min
files: create `contracts/web/README.md`, `contracts/web/schemas/start-request.v1.schema.json`, `job.v1.schema.json`, `event.v1.schema.json`, `error.v1.schema.json`, `manifest.v1.schema.json`, `contracts/web/fixtures/*` (section 2 list), `contracts/test/web.test.mjs`; modify `.github/CODEOWNERS`, `.github/scripts/lane-guard.mjs`, `.github/scripts/test/lane-guard.test.mjs`, `.gitignore`, `.github/workflows/ci.yml`
interfaces: defines everything in section 2
failing test first: `contracts/test/web.test.mjs`: every fixture validates against its schema with the existing ajv; every `data:` line of the three `.sse` files parses and validates as `event.v1`, ids increase, and `events-done.sse` ends in `done`; `manifest.json` URLs resolve to files that exist under `contracts/fixtures/sample/`; every error code in section 2 has one fixture. `lane-guard.test.mjs`: `lane-b/x` touching `web/ui/a.js` passes and `web/viewer/a.js` fails; `lane-c/x` the reverse; `lane-a/x` touching either fails.
steps: write the schemas from section 2; hand-write the fixtures; tag `contracts-web-v1.0.0`; post on the board "@lane-b @lane-c web contract frozen". Changes after the tag follow the contract change-request rule in plan/lanes.md.
done when: `cd contracts && node --test` and `cd .github/scripts && node --test` pass; tag on origin (push only when Abhinav says push); board line posted.
approved installs: none (ajv 8.20.0 is already approved for contracts/)

### T40: Job server, URL check and one-at-a-time queue
owner: Abhinav | lane: A | depends_on: [T39] | estimate: 90 min
files: create `web/server/server.mjs`, `web/server/queue.mjs`, `web/server/urlcheck.mjs`, `web/server/CLAUDE.md`, `web/server/test/fake-orchestrator.mjs`, `web/server/test/server.test.mjs`, `web/server/test/urlcheck.test.mjs`
interfaces: `POST /api/jobs` and `GET /api/jobs/:id` per contract; `node web/server/server.mjs [--port 8787] [--data-dir web-data] [--orchestrator orchestrator/cli.mjs] [--allow-local]`
failing test first: with the fake orchestrator (a script that sleeps, writes contract files into its `--out-dir` and exits with a chosen code), two POSTs give positions 1 and 2, the second starts only after the first exits, and responses validate as `job.v1`; missing consent, empty owner name and a `file:`, `javascript:` or credential-bearing URL return the matching `error.v1`; `urlcheck` refuses 127.0.0.1, ::1, 10.0.0.1, 172.16.0.1, 192.168.1.1, 169.254.169.254, 100.64.0.1, fc00::1 and a hostname whose fake DNS lookup returns a private address, and accepts a public one; `--allow-local` is off by default; the spawned argv is an array containing `--consent-note` and `--out-dir web-data/jobs/<id>`, never `--live` in this task; the server listens on 127.0.0.1 only; on restart, a job left `queued` or `running` becomes `failed` with `server_restarted`; a 6th queued job returns `queue_full`; a run longer than `--timeout-min` (default 45) is killed (`taskkill /T /F` on win32, process group elsewhere) and fails with `timeout`.
steps: jobs persisted as `web-data/jobs/<id>/job.json`; orchestrator stdout and stderr go to `console.log` in the job folder and never to the tester; the consent note is `Owner <name> confirmed consent in the tester app at <ISO time>` with control characters stripped and the name capped at 100 characters. Serves `web/ui/` as static files with the app CSP from section 1 (`default-src 'self'; frame-src, img-src and connect-src add the viewer origin; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`). Warns at start when Node is older than `.nvmrc` (Lane C's build needs 24).
done when: tests pass; `node web/server/server.mjs` serves a placeholder page when `web/ui/` is absent.
approved installs: none

### T41: Start page and fixture mock server
owner: Nirmal | lane: B | depends_on: [T39] | estimate: 90 min
files: create `web/ui/index.html`, `web/ui/css/app.css`, `web/ui/js/api.mjs`, `web/ui/js/start.mjs`, `web/ui/js/validate.mjs`, `web/ui/dev/mock-server.mjs`, `web/ui/CLAUDE.md`, `web/ui/test/validate.test.mjs`, `web/ui/test/mock.test.mjs`, `web/ui/test/no-markup.test.mjs`
interfaces: consumes `start-request.v1`, `job.v1`, `error.v1` from `contracts/web/fixtures/`
failing test first: `validate.mjs` rejects an empty code, a URL without http or https, an empty owner name and an unticked box, with the same plain message the contract fixture uses for each `error.v1` code; `api.mjs` maps every error fixture to a message string; `mock-server.mjs` serves the UI on 8787 and answers `POST /api/jobs` with the fixture response (and the error fixtures through a `?fail=<code>` switch), plus serves `contracts/fixtures/sample/` under the viewer layout on 8788; `no-markup.test.mjs` fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `DOMParser` in any file under `web/ui/`.
steps: one calm form with the PRD design bar (story-first, no shadcn default look, readable at 375 px, visible focus, labels on every field, error text tied with `aria-describedby`); the consent text says in plain words that the tester owns the site or has the owner's permission and that the site will be crawled. On success go to `job.html?id=<job_id>`. Uses relative `/api` paths so the same files work on the real server.
done when: tests pass; master-designer reviews screenshots at 375 px and 1280 px against the mock server and its notes are fixed or listed in `web/ui/CLAUDE.md`.
approved installs: none

### T42: Results viewer: isolated static server
owner: Aditya | lane: C | depends_on: [T39] | estimate: 90 min
files: create `web/viewer/server.mjs`, `web/viewer/CLAUDE.md`, `web/viewer/test/serve.test.mjs`
interfaces: `GET /j/:job_id/run/<path>` and `GET /j/:job_id/report.md` per contract; `node web/viewer/server.mjs --jobs-root <dir> [--port 8788] [--app-origin http://127.0.0.1:8787]`
failing test first: with a temp jobs root holding a copy of `contracts/fixtures/sample/` as `j1/<run_id>/`, `GET /j/j1/run/c-build/site/dist/index.html` returns 200 with `text/html` and every header in section 1 (CSP `sandbox allow-scripts`, `connect-src 'none'`, `form-action 'none'`, `frame-ancestors` equal to the app origin, `nosniff`, `Referrer-Policy: no-referrer`); `report.md` returns `text/plain; charset=utf-8` with CORS for the app origin only; 404 for `10-inventory.json`, `a-scout/...`, `console.log`, `../`, `%2e%2e/`, an encoded backslash, an absolute path, a symlink that leaves the run folder, an unknown job id and a directory without `index.html`; only GET and HEAD are allowed; listens on 127.0.0.1 only.
steps: resolve the run folder as the one child folder of `<jobs-root>/<job_id>/`; resolve every path with `realpath` and check it stays inside an allowed prefix; MIME map for html, css, js, png, jpg, webp, svg, woff2, json; serve `.svg` with the same sandbox CSP.
done when: tests pass on Node 22 and 24.
approved installs: none

### T43: Live progress (SSE), stub detection and results
owner: Abhinav | lane: A | depends_on: [T40] | estimate: 90 min
files: create `web/server/progress.mjs`, `web/server/test/progress.test.mjs`, `web/server/test/sse.test.mjs`; modify `web/server/server.mjs`, `web/server/test/fake-orchestrator.mjs`; modify `contracts/web/fixtures/events-*.sse` (re-recorded)
interfaces: `GET /api/jobs/:id/events`; `job.v1.stages`, `error`, `manifest_url`; starts the viewer as a child process
failing test first: as the fake orchestrator writes `10-inventory.json` to `50-handoff.json` in turn, the stream emits `stage` events in order (running, then done) and ends in `done` whose `manifest_url` is `http://127.0.0.1:8788/j/<id>/manifest.json`; the stream equals `events-done.sse` after normalising ids and times; a reconnect with `Last-Event-ID` gets the full history then live events; exit 3 at scout gives `site_blocked`, exit 3 later `quality_gate`, exit 4 `budget`, other non-zero `crash`; an exit 0 run whose output contains `STUB` and `lane not present` gives `not_real`; every `failed.message` is the fixed contract text and contains no orchestrator output.
steps: progress reads which contract files exist in the run folder (poll every 1 s; `fs.watch` is unreliable on Windows), never their scraped content; the server starts `web/viewer/server.mjs` with `--jobs-root web-data/jobs` when that file exists, and otherwise logs that results cannot be viewed.
done when: tests pass; a real run on the local sample site (`--allow-local`) streams all six stages through `curl -N`.
approved installs: none

### T44: Progress page
owner: Nirmal | lane: B | depends_on: [T41] | estimate: 75 min
files: create `web/ui/job.html`, `web/ui/js/progress.mjs`, `web/ui/js/job.mjs`, `web/ui/test/progress.test.mjs`; modify `web/ui/dev/mock-server.mjs`, `web/ui/css/app.css`
interfaces: consumes `event.v1` and `job.v1`
failing test first: `progress.mjs` (pure, no DOM) folded over each fixture stream gives the expected view state: queue position, the six stages with plain names ("Reading your site", "Writing the story", "Designing three directions", "Judging the directions", "Picking one", "Building and checking"), the final state, and the plain message for every failure code; the mock server replays each `.sse` fixture with a 1 s gap per event and supports `Last-Event-ID`.
steps: `EventSource` with reconnect; falls back to polling `GET /api/jobs/:id` every 5 s if the stream errors; `aria-live="polite"` on the current stage; the page says runs take several minutes and the tab can stay open; on `done` it goes to the results view.
done when: tests pass; master-designer screenshot review at 375 px and 1280 px for queued, running, done and failed states.
approved installs: none

### T45: Viewer manifest and hostile-output red team
owner: Aditya | lane: C | depends_on: [T42] | estimate: 90 min
files: create `web/viewer/manifest.mjs`, `web/viewer/test/manifest.test.mjs`, `web/viewer/test/hostile.test.mjs`, `web/viewer/test/fixtures/hostile-run/` (a run folder whose built page tries `parent.document`, `top.location`, `document.cookie`, `fetch` to the app origin, a form post and `window.open`, and whose `report.md` contains `<script>` and `<img onerror>`); modify `web/viewer/server.mjs`
interfaces: `GET /j/:job_id/manifest.json` returns `manifest.v1`
failing test first: the manifest for the sample run equals `contracts/web/fixtures/manifest-no-bundle.json` (ids aside; `manifest.json` with a bundle_url once T48 lands) and validates; no manifest (404) while `50-handoff.json` is missing; every URL in it is served 200 by the viewer; CORS only for the app origin. Browser check with Aditya's existing Playwright in `lanes/c-build/` (no new install): a test page on the app origin frames the hostile page with `sandbox="allow-scripts"`, and every attack is blocked (no access to the parent, no top navigation, no network request leaves the viewer, no popup); `report.md` is served as text so the `<script>` stays text.
steps: build the manifest from `50-handoff.json` `site.pages[]` and `report_path`, and `40-verdict.json` `compare_path`, mapping each to a `/run/` URL; ignore any path that would leave an allowed prefix.
done when: tests pass; red-team result (attacks tried, all blocked) posted on the board.
approved installs: none

### T46: Results page with safe report rendering
owner: Nirmal | lane: B | depends_on: [T44] | estimate: 90 min
files: create `web/ui/js/results.mjs`, `web/ui/js/report.mjs`, `web/ui/test/report.test.mjs`, `web/ui/test/results.test.mjs`; modify `web/ui/job.html`, `web/ui/css/app.css`, `web/ui/dev/mock-server.mjs`
interfaces: consumes `manifest.v1` and `report.md` from the viewer origin
failing test first: `report.mjs` turns markdown into a plain tree of `{tag, text}` nodes (headings, paragraphs, lists, bold only) and builds DOM with `createElement` and `textContent`; `<script>`, `<img onerror=...>`, `[x](javascript:...)` and raw HTML in the input come out as literal text; links are not made clickable; `results.mjs` builds the view from `contracts/web/fixtures/manifest.json`: a page picker, iframes with exactly `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`, screenshot `<img>` tags with alt text from the slug, the gates and fidelity line in plain words.
steps: four views: Redesign (iframe, page picker, open-in-new-tab link to the viewer URL), Report (text), Compare (iframe), Screenshots (desktop and mobile side by side, mobile stacked at 375 px). A note says the redesign is a preview from automated tools and lists what the report flags for manual work.
done when: tests pass; master-designer screenshot review against the mock server; `no-markup.test.mjs` still passes.
approved installs: none

### T47: Invite codes, daily limits, dollar cap and the live switch
owner: Abhinav | lane: A | depends_on: [T40] | estimate: 90 min
files: create `web/server/invites.mjs`, `web/server/admin.mjs`, `web/server/test/invites.test.mjs`, `web/server/test/caps.test.mjs`; modify `web/server/server.mjs`, `web/server/queue.mjs`
interfaces: `invite_invalid`, `invite_used_today` (`daily_cap_reached` stays in the contract but is never sent in v1); `node web/server/admin.mjs invite add <label>`, `invite list`, `invite reset <label>`, `invite revoke <label>`, `live <job_id> on|off`, `spend`
failing test first: `invite add` prints a code once and `invites.json` holds only its SHA-256 hash and the label (the test greps the file for the code and finds nothing); comparison uses `crypto.timingSafeEqual`; a second accepted run on the same code on the same America/Los_Angeles day returns `invite_used_today`, and the next day it works; revoked codes return `invite_invalid`; a job runs with `--live` only when `web-data/jobs/<id>/live.flag` exists at the moment it starts, and `job.v1.mode` says so; a live job is refused at start (failed `budget`) when today's spend plus the run template's `limits.lane_budget_usd` b plus c exceeds `--daily-usd-cap` (default 0, so live is impossible until Abhinav sets it); after every run the server adds `cost_usd` from `40-verdict.json` and `50-handoff.json` to `spend.json`, and a free run with cost above 0 is logged as a warning and still counted; a live job that would start when today's spend is at or above the cap fails with `budget`; `daily_cap_reached` is never sent in v1.
steps: codes are 12 characters from an unambiguous alphabet via `crypto.randomBytes`; the job keeps the invite label, never the code; `admin.mjs` only edits files under the data dir and never talks to the network.
done when: tests pass; `admin.mjs invite add pilot-1` then a real POST with that code works once per day.
approved installs: none

### T48: Download bundle (tar.gz, stdlib only)
owner: Aditya | lane: C | depends_on: [T45] | estimate: 60 min
files: create `web/viewer/bundle.mjs`, `web/viewer/test/bundle.test.mjs`; modify `web/viewer/server.mjs`, `web/viewer/manifest.mjs`
interfaces: `GET /j/:job_id/bundle.tar.gz`; `manifest.v1.bundle_url`
failing test first: the bundle of the sample run, gunzipped with `node:zlib` and parsed by a 30 line ustar reader in the test, lists exactly the files under `c-build/site/dist/` plus `report.md`, each byte-identical; names are relative with no `..` and no absolute paths; served with `Content-Disposition: attachment; filename="<site_slug>-redesign.tar.gz"`; `bundle_url` is null when the run has no `dist/`.
steps: write the ustar headers by hand (512 byte blocks, octal sizes, checksum), stream through `zlib.createGzip`; skip symlinks.
done when: tests pass; the bundle opens with `tar -xzf` on Windows (bsdtar) and Git Bash.
approved installs: none

### T49: Outside tester rehearsal (success metric)
owner: Abhinav | lane: A | depends_on: [T43, T45, T46, T47] | estimate: 60 min
files: create `web/server/test/e2e.test.mjs`, `web/server/RUNBOOK.md`
interfaces: whole app
failing test first: `e2e.test.mjs` starts the real server and viewer with the fake orchestrator, creates an invite, POSTs a job, reads the SSE stream to `done`, fetches the manifest and one page from the viewer, and checks the viewer page carries the sandbox CSP and the app page carries the app CSP.
steps: 1. Abhinav runs a free run on the local sample site with `--allow-local`. 2. A run on a site that redirects to 127.0.0.1 is refused or contained (if Scout follows it, file it on the board as a Scout follow-up and stop before step 3). 3. Abhinav hands one invite code to an outside tester on a site they own, sits beside them on his laptop, and says nothing. 4. Record pass or fail and every place they hesitated in the runbook.
done when: the e2e test passes and an outside tester completed a free run on their own site and opened the redesign and the report without help (or the failure and the fix tasks are posted on the board).
approved installs: none

### T50: Deploy to a host (approval gated)
owner: Abhinav | lane: A | depends_on: [T49] | estimate: set at approval
gate before starting: Abhinav picks the host and Vidyut approves the host, the domain names and the spend in chat; no account, DNS record or deploy before that.
files: set at approval (expected: `web/server/DEPLOY.md` and the server's host config)
interfaces: same API; the viewer moves to its own registrable domain (not a subdomain of the app), HTTPS on both, the app CSP and viewer `frame-ancestors` updated to the real origins
failing test first: the e2e test passes against the two configured origins on a staging host; the viewer's origin differs from the app's in registrable domain.
steps: overlaps T30 (Aditya's preview publish): if the host chosen in T30 serves static output, the viewer may point at the same host; decide at approval.
done when: approved, deployed, and the T49 rehearsal repeated on the hosted app.
approved installs: none until the host is approved

## 5. Claims we will make
- C1 | planned | An invited tester can start a redesign of their own site from a browser with an invite code, the owner's name and a consent box | proof: web/server/test/e2e.test.mjs, T49 runbook
- C2 | planned | The tester watches each stage live | proof: web/server/test/sse.test.mjs, web/ui/test/progress.test.mjs
- C3 | planned | Built output from a scraped site cannot script the app: separate origin, sandboxed iframe, sandbox CSP | proof: web/viewer/test/hostile.test.mjs
- C4 | planned | Scraped text is never rendered as markup | proof: web/ui/test/no-markup.test.mjs, web/ui/test/report.test.mjs
- C5 | planned | Invite codes are never stored in plain text; one run per code per day | proof: web/server/test/invites.test.mjs
- C6 | planned | Paid models run only when Abhinav flips the switch for that run, and never past the daily dollar cap | proof: web/server/test/caps.test.mjs
- C7 | planned | A tester never sees the sample fixture passed off as their site | proof: web/server/test/progress.test.mjs (not_real)
- C8 | planned | The server refuses private and local addresses as targets | proof: web/server/test/urlcheck.test.mjs
- C9 | planned | An outside tester finished a free run and opened the redesign without help | proof: web/server/RUNBOOK.md T49 entry
- C10 | planned | The app adds no dependency and changes no lane's pipeline code | proof: `git diff --name-only` for T39 to T49 lists only contracts/web/, web/, .github/, .gitignore
