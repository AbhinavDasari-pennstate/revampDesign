# Morning report, Wed Nov 11 2026 (tester web app, night 1)

## Done and merged to main (each: builder, master-reviewer PASS, CI 9/9)
| Task | PR | Review | What it gives you |
|---|---|---|---|
| T39 web API contract | #36, tag `contracts-web-v1.0.0` | PASS after 2 fix rounds | Frozen formats for server, UI and viewer, with fixtures; lane guard and CI jobs for `web/ui/` (Nirmal) and `web/viewer/` (Aditya) |
| T40 job server | #37 | PASS first round | `node web/server/server.mjs`: start a run, one at a time, URL check refuses private and local addresses, 127.0.0.1 only |
| T47 invites and caps | #38 | FIX (spend undercount) then PASS | `node web/server/admin.mjs invite add <label>` prints a code once; one run per code per day; paid switch per job; dollar cap, default 0 |
| T43 live progress | #39 | PASS, small fix, PASS | Live stage stream, failure codes, a run that used sample stand-ins is never shown as the tester's site |

## Real check
A free run on the local sample site through the web server streamed all six stages and finished with a viewer link in 170 s (`--allow-local`, no paid models, $0).

## Teammates
- Nirmal: issue #34 (T41, T44, T46, the pages). Note added on how T44 should draw stages after a failure.
- Aditya: issue #35 (T42, T45, T48, the results viewer). The server already starts `web/viewer/server.mjs` once it exists.

## Rulings I made overnight (plan/rulings.md, change any you disagree with)
1. The dollar cap counts only paid runs, and is checked when a paid run is about to start; over the cap it fails as `budget`. `daily_cap_reached` is reserved, never sent.
2. Spend counts all of Lane B's stages from `b-design/cost.jsonl`, not only the council.
3. The queue holds 5 places counting the running one; a host that does not resolve is refused.
4. The progress fixtures were not re-recorded under the freeze; tests compare parsed events instead.

## Needs you
- Nothing blocks the teammates.
- Before a paid run: add OpenRouter credits, make the names ruling, then start the server with `--daily-usd-cap <dollars>`.
- T49 (outside tester rehearsal) waits on T44, T46 and T45. T50 (deploy) needs your approval.

## Incident
Removing the T47 worktree emptied `contracts/node_modules` in the main checkout, because the builder had linked it with a Windows junction. I reinstalled it from the lockfile (ajv 8.20.0, already approved). The rule is now in plan/playbook-notes.md.
