# Web API contract v1 (freeze tag `contracts-web-v1.0.0`)

The only way the three web folders talk to each other: `web/server/` (Lane A, Abhinav), `web/ui/` (Lane B, Nirmal) and `web/viewer/` (Lane C, Aditya). Owned by Lane A. Lanes B and C read these files as data, never import code from here, and build and test only against `fixtures/`. The schemas are the truth; this page explains what a schema cannot say. Product background: `plan/web-plan.md`, sections 1 to 3.

Changes after the tag follow the contract change-request rule in `plan/lanes.md`: a GitHub issue labelled `contract-cr`, additive fields only, a new schema file next to the v1 one and a minor tag. Abhinav creates the tag after review; the commit that adds these files does not.

## Why the payloads carry no `contract` or `version` field
The run-folder contracts in `contracts/schemas/` are files that sit on disk and travel between lanes, so each one declares which schema it follows. These HTTP payloads are made and read in the same moment, and the route already names the schema (the table below), so a version field would only be a second place to get wrong. A breaking change would ship as a new schema name (`job.v2`) on a new route, never as a field in the body. For the same reason `contracts/validate.mjs`, which picks a schema from the `contract` field, does not load these schemas. Validate with your own Ajv (draft 2020-12, `strict: true`, all five schemas added) by `$id`: `job.v1`, `event.v1#/$defs/stage`. The `web/` folders have no dependencies, so they check payloads with small hand-written checks against the fixtures; the full schema check is `test/web.test.mjs` in this folder's parent.

## Origins and routes
App server, `http://127.0.0.1:8787`, built by Lane A. Viewer, `http://127.0.0.1:8788`, built by Lane C, read-only over the job folders.

| Route | Request | Success | Failure |
|---|---|---|---|
| `POST /api/jobs` | `start-request.v1` as JSON | `202` `job.v1` (status `queued`) | `error.v1`, status per code below |
| `GET /api/jobs/:job_id` | none | `200` `job.v1` | `404` `error.v1` (`not_found`) |
| `GET /api/jobs/:job_id/events` | optional `Last-Event-ID` | `200` `text/event-stream` of `event.v1` | `404` `error.v1` (`not_found`), as JSON, not a stream |
| `GET /j/:job_id/manifest.json` | none | `200` `manifest.v1` | `404`, only once `50-handoff.json` exists |
| `GET /j/:job_id/run/<path>` | none | a file of the run, only under `c-build/site/dist/`, `c-build/screens/`, `b-design/compare.html`, `b-design/previews/`, `b-design/boards/` | `404` for everything else |
| `GET /j/:job_id/report.md` | none | `c-build/report.md` as `text/plain; charset=utf-8` | `404` |
| `GET /j/:job_id/bundle.tar.gz` | none | the built site as a download | `404` |

The viewer allows CORS for the app origin only, on the manifest and the report. The security headers of every viewer and app response are listed in `plan/web-plan.md` section 1. Any other path or method under `/api/` answers `404` `not_found`. A bug inside the server is not part of this contract: pages show their own generic message for any response that is not a valid `error.v1`.

## Starting a job: `POST /api/jobs`
`start-request.v1` is `{invite_code, url, owner_name, consent: true}`. The schema describes a request that is accepted. Every field has exactly one code that covers whatever is wrong with it, and the server checks in this order, first failure wins:

| # | Rule | Code | HTTP |
|---|---|---|---|
| 1 | The body is not a JSON object, has a field the schema does not list, is larger than 4 KiB, or `owner_name` is longer than 200 Unicode code points (`[...s].length`) | `bad_request` | 400 |
| 2 | `url` is missing, is not an http or https address, is longer than 2048 characters, carries a user name or password (the schema is looser than the server here, so this rule is the guard), or cannot be parsed | `bad_url` | 400 |
| 3 | `owner_name` is missing, is not a string, or is empty after trimming spaces | `owner_name_required` | 400 |
| 4 | `consent` is missing or is anything other than the boolean `true` | `consent_required` | 400 |
| 5 | `invite_code` is missing, empty, unknown or revoked | `invite_invalid` | 403 |
| 6 | The invite code already started an accepted run today (America/Los_Angeles day) | `invite_used_today` | 429 |
| 7 | The live switch is on and today's paid (live) spend is at or above the daily dollar cap; a free run never reaches this rule | `daily_cap_reached` | 503 |
| 8 | After a DNS lookup the host is loopback, private, link-local, CGNAT or unique-local IPv6 | `host_not_public` | 400 |
| 9 | The waiting line has no room | `queue_full` | 503 |

Rules 1 to 4 need no secret and no network. The DNS lookup (rule 8) comes after the invite checks, so a caller without a valid code cannot use the server to resolve names. The server writes at most the first 100 Unicode code points (the same unit as `[...s].length`, so an emoji counts once) of `owner_name` into the consent note.

Rule 7 and the dollar cap: the daily dollar cap limits paid (live) spend only. A free run is never refused with `daily_cap_reached`. A POST is refused with `daily_cap_reached` only when the live switch is on and today's spend is at or above the cap. A cap of 0, the default, means a live run is never allowed. A live job that passes this check at POST time but is refused when it reaches the head of the line fails with `budget` instead (see the mapping below).

The schema is looser than the server on credential URLs: `start-request.v1` accepts `https://user:pass@host/`, and rule 2 is the guard that answers `bad_url`. A page that validates against the schema has therefore not been fully checked.

## `job.v1`
- `job_id`: 22 characters of base64url, 128 random bits. Never the invite code.
- `status`: `queued`, then `running`, then `done` or `failed`. It only moves forward.
- `position`: while `queued`, the 1-based place in line, and the run in progress counts as a place: `1` means nothing is ahead and the job starts next, `2` means one run is ahead. `null` in every other status.
- `mode`: `free` or `live`.
- `stages`: always six entries in this order: `scout`, `story`, `art`, `council`, `select`, `build`, each `pending`, `running`, `done` or `failed`. At most one is `running`. If a job fails while a stage is running, that stage becomes `failed` and the later ones stay `pending`. A job that failed before it started has six `pending`. A `not_real` job has six `done`: the run finished, the result is not real.
- `created_at`, `started_at`, `finished_at`: UTC in the form `2026-11-11T18:00:00.000Z` (`Date.prototype.toISOString()`). `started_at` is `null` while queued and for a job that failed before it started; `finished_at` is `null` until the job is `done` or `failed`.
- `error`: `null` unless `failed`; then `{code, message}` with a run failure code and its fixed text below. Never scraped text, orchestrator output or a stack trace.
- `manifest_url`: the viewer manifest URL, set only when `done`.

The schema enforces which combination of `position`, `started_at`, `finished_at`, `error` and `manifest_url` each status allows, and it pins `message` to the exact text of its code.

## Progress stream: `GET /api/jobs/:job_id/events`
- `Content-Type: text/event-stream; charset=utf-8`. Parsers accept LF and CRLF line ends and ignore lines that start with a colon.
- Each event has `id:` (1, 2, 3, ... in order), `event:` (the name) and one `data:` line holding compact JSON. The name decides the shape, and `event.v1` is the union of the five shapes (`event.v1#/$defs/<name>` checks one):

| `event:` | `data:` | Sent when |
|---|---|---|
| `queued` | `{position}` | the job is accepted, and again whenever its place in line changes |
| `started` | `{mode}` | the run begins |
| `stage` | `{stage, state}` with state `running`, `done` or `failed` | a stage begins, ends, or is the one that was running when the job failed |
| `done` | `{manifest_url}` | the run finished and its result is real |
| `failed` | `{code, message}` with a run failure code | the job failed |

- On connect the server always sends the whole history from `id: 1` and then live events, also when `Last-Event-ID` is present. A client that reconnects skips ids it has already handled.
- A stream ends with exactly one `done` or `failed`, and the server then closes it. A queued job's stream stays open.
- The server sends a `: ping` comment line every 15 seconds.
- `fixtures/events-queued.sse` stops early on purpose: it is a stream that is still waiting. A mock server keeps the connection open after its last event.

## Viewer: `manifest.v1`
Built only from the run's `50-handoff.json` and `40-verdict.json`, and served only once `50-handoff.json` exists.

| Manifest field | Source |
|---|---|
| `job_id` | the job id in the URL |
| `site.pages[]` | `50-handoff.json` `site.pages[]`: `slug`, `url` is `/run/` plus `path`, `screenshots.desktop` and `.mobile` are `/run/` plus the same keys |
| `site.home_url` | the `url` of the page whose slug is `home`, or of the first page when none is |
| `compare_url` | `/run/` plus `40-verdict.json` `compare_path` |
| `report_url` | `/j/<job_id>/report.md`, which serves `report_path` |
| `bundle_url` | `/j/<job_id>/bundle.tar.gz` when the run has `c-build/site/dist/`, otherwise `null` |
| `gates` | `passed` is `qa.gates_passed`, `axe_serious` and `axe_critical` are `qa.axe.serious` and `.critical` |
| `fidelity` | `pages_carried` and `pages_total` |

Every URL is absolute, on the viewer's own origin, and carries the same job id as `job_id`. The schema refuses `..` in a run path; the viewer drops any path that would leave an allowed folder. `bundle_url` is always present: `null` means there is no download. Until T48 adds the bundle route, the viewer answers `null` and its test compares against `fixtures/manifest-no-bundle.json`; from T48 it compares against `fixtures/manifest.json`.

## Error codes and their fixed text
Messages are written for a school office or small organisation owner. They are part of the contract: the schemas accept no other text, and servers and pages copy them from here.

| Code | HTTP | Where | Message |
|---|---|---|---|
| `bad_request` | 400 | `error.v1` | We could not read that request. Please reload the page and try again. |
| `bad_url` | 400 | `error.v1` | That does not look like a web address we can use. Enter the full address of your site, starting with http or https. |
| `host_not_public` | 400 | `error.v1` | We can only redesign sites that anyone on the internet can open. That address points to a private or local computer. |
| `owner_name_required` | 400 | `error.v1` | Please enter the name of the person who owns this site. |
| `consent_required` | 400 | `error.v1` | Please tick the box to confirm that you own this site or have the owner's permission. |
| `invite_invalid` | 403 | `error.v1` | That invite code was not recognised. Check it and try again. |
| `invite_used_today` | 429 | `error.v1` | This invite code has already been used today. Please try again tomorrow. |
| `daily_cap_reached` | 503 | `error.v1` | We have reached our limit for today. Please try again tomorrow. |
| `queue_full` | 503 | `error.v1` | Several redesigns are waiting right now. Please try again in a little while. |
| `not_found` | 404 | `error.v1` | We could not find that. Check the link and try again. |
| `site_blocked` | none | `job.v1` `error`, `failed` event | We could not open any page of your site. It may block automated visitors, or it may be offline. |
| `quality_gate` | none | `job.v1` `error`, `failed` event | We could not finish a redesign that passes our quality checks, so we are not showing one. |
| `budget` | none | `job.v1` `error`, `failed` event | This run reached its spending limit before it finished, so it was stopped. |
| `not_real` | none | `job.v1` `error`, `failed` event | This run could not build a real redesign of your site, so there is nothing to show. |
| `timeout` | none | `job.v1` `error`, `failed` event | This run took too long and was stopped. Please try again later. |
| `crash` | none | `job.v1` `error`, `failed` event | Something went wrong on our side while building your redesign. Please try again later. |
| `server_restarted` | none | `job.v1` `error`, `failed` event | The server restarted while your run was in progress, so it was stopped. Please start it again. |

How the server maps what it saw to a run failure code (T43): exit 3 at scout is `site_blocked`, exit 3 later is `quality_gate`, exit 4 is `budget` (`budget` also covers a live job that is refused at start: all six stages `pending`, `started_at` null, `mode` `live`, see `fixtures/job-failed-budget-at-start.json`), an exit 0 whose output shows a stub fallback is `not_real`, a killed run is `timeout`, any other non-zero exit is `crash`, and a job left `queued` or `running` when the server starts again is `server_restarted`.

## Fixtures
All data is fictional: the site is Maple Grove High School from `contracts/fixtures/sample/`, the invite code is made up, and every fixture uses the job id `Xk3nP9qLm2VbT7sRw4YdHa`. Times are fixed, so a re-recording from the real server compares after ids and times are normalised. `.gitattributes` stores the `.sse` files with LF line ends on every machine, and consumers and re-recordings compare parsed events, never raw text.

| File | Holds |
|---|---|
| `fixtures/start-request.json` | the one valid request |
| `fixtures/job-queued.json`, `job-running.json`, `job-done.json` | one `job.v1` response each |
| `fixtures/job-failed-<code>.json` | a failed `job.v1` for each of the seven run failure codes, stages as the failure would leave them |
| `fixtures/job-failed-budget-at-start.json` | a second `budget` failure: a live job refused before it started, stages all `pending`, `started_at` null |
| `fixtures/error-<code>.json` | an `error.v1` body for each of the ten API codes |
| `fixtures/manifest.json` | `manifest.v1` for the sample run in `contracts/fixtures/sample/`, bundle link set |
| `fixtures/manifest-no-bundle.json` | the same manifest with `bundle_url` null |
| `fixtures/events-done.sse` | a whole successful run: queued, started, six stages, done |
| `fixtures/events-failed.sse` | a run that fails at build with `quality_gate` |
| `fixtures/events-queued.sse` | a job still waiting, positions 3, 2, 1, with a `: ping` line |

## Check it
```
cd contracts && npm ci
node --test        # runs test/web.test.mjs with the run-folder tests
```
The test validates every fixture against its schema, reads each `.sse` file event by event, checks that every manifest URL maps to a file in `contracts/fixtures/sample/`, that every code has a fixture, and that a changed message or a wrong combination of fields is rejected.
