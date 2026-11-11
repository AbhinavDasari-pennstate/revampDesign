# web/server: the tester app server (Lane A, Abhinav)

Wraps the orchestrator behind a small HTTP API for invited testers. Plan: `plan/web-plan.md` (T40 to T50). The API is frozen in `contracts/web/` (tag `contracts-web-v1.0.0`): never edit it from here; follow `contracts/web/README.md` for the check order, the status per code and the fixed messages.

## Run and test
- `node web/server/server.mjs [--port 8787] [--data-dir web-data] [--orchestrator orchestrator/cli.mjs] [--timeout-min 45] [--allow-local]`
- `cd web/server && node --test` (no network, no real crawl). The tests validate every body with the ajv in `contracts/node_modules`: run `npm ci` in `contracts/` once.
- `test/fake-orchestrator.mjs` stands in for `orchestrator/cli.mjs`; each job is steered by the query string of its url (`?sleep=300&exit=1&child=1&noise=1`, see the file header). `node --test` runs every file under `test/`, so the fake does nothing when started with no arguments.

## Files
- `server.mjs`: routes, the request checks in contract order, static files of `web/ui/`, command line.
- `queue.mjs`: job records (`web-data/jobs/<id>/job.json`), the one-at-a-time line, the child process, timeout kill, restart recovery.
- `urlcheck.mjs`: rule 2 (`parseTarget`) and rule 8 (`checkHost`, `isPublicAddress`).
- `messages.mjs`: the fixed texts and HTTP statuses; a test compares them with the contract fixtures.

## Rules for this folder
- Node stdlib only, Node 22 and 24. No `package.json` dependencies.
- Listen on 127.0.0.1 only; there is deliberately no host option.
- The orchestrator is started with an argument array and `shell: false`. Its stdout and stderr go to `console.log` in the job folder and never to a response. Run failure text comes only from `messages.mjs`, never from scraped text or orchestrator output.
- No cookies. Static files are read as files, never executed; `dev/` and `test/` of `web/ui/`, dot files and non-web file types are never served.
- A request that fails a rule never uses up an invite code, and no DNS lookup happens before rules 1 to 6 pass.
- Never `--live` until T47. No em dashes or en dashes anywhere.

## Seams for later tasks
- T47 passes `invites: { check(code) -> null | { label, usedToday }, recordUse(label) }` to `createApp`. With none, every POST is refused as `invite_invalid` (the safe default). The `--live` flag and the dollar cap at start belong in `JobQueue#start` (the one place the argv is built).
- T43 replaces `classifyExit` in `queue.mjs` (exit 3, exit 4, `not_real`) and subscribes to `queue.on('event', (job_id, name, data))`, whose shapes are `event.v1`. Until T43, `stage` events are never emitted and an exit 0 run is `done` with six `done` stages.

## Decisions made in T40 where the contract is silent
- The line holds at most 5 places (`maxLine`), the run in progress counting as one, so the 6th start request gets `queue_full`.
- A host that does not resolve (or whose lookup takes over 5 s) is refused as `bad_url`, never let through; any private address among the answers is `host_not_public`. Scout resolves the name again, so a hostile DNS that answers differently the second time is not stopped by this check: T49 step 2 probes redirects, and real isolation needs egress filtering.
- `url.href` (the normalised address that was checked) is what the orchestrator gets.
- Owner name: tabs and line breaks become a space, other control characters are dropped, spaces collapse; a name empty after that is `owner_name_required`; the consent note holds the first 100 code points.
- Static files are served at the root and under `/ui/` (both work).
