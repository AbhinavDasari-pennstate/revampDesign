# web/server: the tester app server (Lane A, Abhinav)

Wraps the orchestrator behind a small HTTP API for invited testers. Plan: `plan/web-plan.md` (T40 to T50). The API is frozen in `contracts/web/` (tag `contracts-web-v1.0.0`): never edit it from here; follow `contracts/web/README.md` for the check order, the status per code and the fixed messages.

## Run and test
- `node web/server/server.mjs [--port 8787] [--data-dir web-data] [--orchestrator orchestrator/cli.mjs] [--timeout-min 45] [--daily-usd-cap 0] [--allow-local]`
- `node web/server/admin.mjs [--data-dir web-data] invite add <label> | invite list | invite reset <label> | invite revoke <label> | live <job_id> on|off | spend`. `invite add` prints the code once. Use the same `--data-dir` as the server.
- `cd web/server && node --test` (no network, no real crawl, never a paid model). The tests validate every body with the ajv in `contracts/node_modules`: run `npm ci` in `contracts/` once (the CI job `web-server` does, and a test fails in CI when ajv is missing).
- `test/fake-orchestrator.mjs` stands in for `orchestrator/cli.mjs`; each job is steered by the query string of its url (`?sleep=300&exit=1&child=1&noise=1&vcost=0.3&hcost=0.2&files=1&gate=1`, see the file header). `node --test` runs every file under `test/`, so the fake and `harness.mjs` do nothing when loaded without arguments. `harness.mjs` holds what the test files share (the server on an ephemeral port, the contract checks).

## Files
- `server.mjs`: routes, the request checks in contract order, static files of `web/ui/`, command line.
- `queue.mjs`: job records (`web-data/jobs/<id>/job.json`), the one-at-a-time line, the child process, timeout kill, restart recovery, the live switch, the dollar cap at the head of the line, the cost of each run into `spend.json`.
- `invites.mjs`: the invite store (`web-data/invites.json`), codes, hashes, the one run per Los Angeles day rule.
- `ledger.mjs`: the Los Angeles day, atomic JSON files, `spend.json`, the job id check and the name of the live flag, shared by the server and `admin.mjs`.
- `admin.mjs`: the admin tool. It edits files under the data dir and never talks to the network.
- `urlcheck.mjs`: rule 2 (`parseTarget`) and rule 8 (`checkHost`, `isPublicAddress`).
- `messages.mjs`: the fixed texts and HTTP statuses; a test compares them with the contract fixtures.

## Rules for this folder
- Node stdlib only, Node 22 and 24. No `package.json` dependencies.
- Listen on 127.0.0.1 only; there is deliberately no host option.
- The orchestrator is started with an argument array and `shell: false`. Its stdout and stderr go to `console.log` in the job folder and never to a response. Run failure text comes only from `messages.mjs`, never from scraped text or orchestrator output.
- No cookies. Static files are read as files, never executed; `dev/` and `test/` of `web/ui/`, dot files and non-web file types are never served.
- A request that fails a rule never uses up an invite code, and no DNS lookup happens before rules 1 to 6 pass. The code is used up only after the job was accepted (`queue.add` first, then `recordUse`).
- Invite codes are never stored: only a salted SHA-256 hash (`invites.json`, gitignored `web-data/`), compared with `crypto.timingSafeEqual` against every entry. A job keeps the invite label, never the code. `invite_code` must be a non empty string before the store sees it.
- `--live` is added in exactly one place, `JobQueue#start`, and only for a job whose `live.flag` exists at that moment and that passed the cap check. The default cap is 0, so every live job fails at start with `budget` until Abhinav sets `--daily-usd-cap`. A free run is never refused for the cap. `daily_cap_reached` is reserved by the contract and never sent.
- No em dashes or en dashes anywhere.

## Seams for later tasks
- T43 replaces `classifyExit` in `queue.mjs` (exit 3, exit 4, `not_real`) and subscribes to `queue.on('event', (job_id, name, data))`, whose shapes are `event.v1`. Until T43, `stage` events are never emitted and an exit 0 run is `done` with six `done` stages.
- `createApp({ invites: { check(code) -> null | { label, usedToday }, recordUse(label) } })`: with none, every POST is refused as `invite_invalid` (the safe default). `server.mjs` wires the real store from `invites.mjs`; tests inject small stand-ins.

## Decisions made in T40 where the contract is silent
- The line holds at most 5 places (`maxLine`), the run in progress counting as one, so the 6th start request gets `queue_full`.
- A host that does not resolve (or whose lookup takes over 5 s) is refused as `bad_url`, never let through; any private address among the answers is `host_not_public`. Scout resolves the name again, so a hostile DNS that answers differently the second time is not stopped by this check: T49 step 2 probes redirects, and real isolation needs egress filtering.
- `url.href` (the normalised address that was checked) is what the orchestrator gets.
- Owner name: tabs and line breaks become a space, other control characters and Unicode format characters (category Cf: bidi controls, zero width characters, the byte order mark) are dropped, spaces collapse; a name empty after that is `owner_name_required`; the consent note holds the first 100 code points. Dropping Cf also drops the zero width joiner, so a joined emoji such as a family loses its joins.
- Static files are served at the root and under `/ui/` (both work).

## Decisions made in T47 where the plan and the contract are silent
- The store file: `{ salt, invites: [{ label, hash, created_at, revoked, last_used_day }] }`. `hash` is SHA-256 of the 16 byte salt followed by the code. Codes are 12 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (about 59 bits); a typed code is trimmed and upper cased before it is hashed. Labels are 1 to 40 of letters, digits, `.`, `-`, `_`, starting with a letter or digit, unique without regard to case.
- The server and `admin.mjs` are separate processes, so every store call re-reads `invites.json` and every change writes the whole file at once (temp file, then rename). A corrupt file refuses every code, is logged, and is never overwritten. Two processes saving in the same instant could still lose one write; the admin tool is run by hand.
- If saving the use fails after the job was accepted, the job still goes ahead (it is already in the line) and the failure is logged; a disk error in `queue.add` itself fails the request with 500 and leaves the code unused.
- The cap check, when a live job leaves the line: refuse when today's spend is at or above the cap, or when today's spend plus lane budgets `b` plus `c` of the run template is over the cap (exactly reaching it is allowed). The template is `contracts/fixtures/sample/00-run.json`, the file the orchestrator starts from by default (`--fixture sample`); lane `a` has no paid model and is not counted. If `spend.json` or the template cannot be read the answer is no.
- `spend.json` is `{ "<America/Los_Angeles day>": <dollars> }`, kept by day of finishing. After every run (also failed, timed out, or killed with the server and recovered at the next start) the `cost_usd` of `40-verdict.json` and `50-handoff.json` in every run folder of the job is added, rounded to a millionth of a dollar. A cost that is not a number of at least 0 is ignored with a warning; a free run that reports a cost is warned about and still counted.
- Known gaps: a live run that dies before it writes either file leaves its spend uncounted (the lanes enforce their own `b` and `c` caps); `admin.mjs live` only works for a job that is still queued, because the flag is read once, as the job starts.
