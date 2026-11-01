# Lane A audit (G4, master-planner senior review, Sun Nov 1 2026)

**Verdict: ship with changes.** Lane A is the right shape, but four things would hurt on Mon to Wed: T07 calls real lane CLIs before T17 exists (so Monday's test could run Nirmal's or Aditya's code); Scout cannot follow the exit 3 rule because inventory.v1 needs at least one page; T16 waits on an unapproved dembrandt it does not need; and the "no request outside the target host" test cannot pass with a real browser. All fixes stay inside Lane A and change no contract. The accepted-by-default edits are already made in plan/plan.md, each marked "(revised G4)".

## Evidence (what I checked myself)
- VERIFIED by running it: `node contracts/validate.mjs contracts/fixtures/sample/10-inventory.json` prints valid (exit 0); an invalid fixture exits 2; `--cross contracts/fixtures/sample` prints valid. Node is v20.13.1 here.
- VERIFIED by running a script outside `contracts/` that imports `contracts/validate.mjs`: Ajv resolves from `contracts/node_modules`, and `schemaErrors` returns [] for the sample inventory. So the orchestrator and Scout can both use it with no new install, **as long as `cd contracts && npm ci` has run**.
- VERIFIED: the same import from `node -e` crashes at `validate.mjs:85` (`pathToFileURL(process.argv[1])` with argv[1] undefined). Harmless for real scripts and `node --test` files, but never import it from `-e` or a REPL.
- VERIFIED: inventory.v1 has `pages` minItems 1 and no `status` field (`/pages must NOT have fewer than 1 items`). Path fields reject backslashes and drive letters (a Windows `a-scout\screens\x.png` fails the schema), so the schema itself catches the most likely Windows bug.
- VERIFIED: `lanes/a-scout/package.json` pins playwright 1.64.1 only (no Ajv); `contracts/package.json` pins ajv 8.20.0. There is no `.gitattributes`. `ci.yml` installs only `contracts/` (lines 18 to 25 checked); I did not read the rest of ci.yml.
- VERIFIED: `make-sample-fixture.mjs` already serves `contracts/fixtures/sample-site/` with `node:http` on port 0 and takes Playwright screenshots, but the inventory in it is **hand-written** (nav and footer are blocks b090 and b091; person and legal facts are reworded labels). A Scout run will not reproduce those ids or labels, so tests must compare a projection, not the whole file.
- VERIFIED: `import.meta.dirname` exists from Node 20.11, so make-sample-fixture.mjs runs on 20.13 and 24.
- Not checked: the Lane B and C folders (off-limits); the rest of ci.yml; whether the sample-site HTML uses `<address>` or `<p>` for the contact block (the T08 golden test will show it).

## Answers to the three questions
**Fetch plus parser, or Playwright for both?** Playwright for both. Node has no built-in HTML parser, so fetch plus a parser means one more package to approve; Playwright is already approved, is needed for screenshots anyway, and one `page.goto` per page gives text, links, images, forms, computed styles and the screenshot. It also renders JavaScript sites; Prism's frontend is a Vite React app (REPORTED from the repo's `frontend/src/main.jsx` rule), so fetch would see an empty shell on the Wed run. Use plain `fetch` for robots.txt only. Fewest dependencies: Playwright alone (one package, already installed).

**BFS plus sitemap plus robots?** BFS plus robots is right-sized; cut the sitemap for this week. School sitemaps list hundreds of news posts that would fill the 40-page cap with junk, while BFS from the home page reaches the pages that matter first. robots.txt stays (Global Constraints require it), parsed minimally: `Disallow` prefixes under `User-agent: *`, nothing else.

**dembrandt?** Not needed. inventory.v1 `brand` wants `logo_path`, `colors[] {hex, role}` and `fonts[] {family, usage}`. One `page.evaluate` of `getComputedStyle` on body, the first h1, the first link and the nav gives all of it, and the logo is an element screenshot exactly as make-sample-fixture.mjs already does. This takes an unapproved install off the Tuesday critical path.

**Second fixture site?** No. Reuse `contracts/fixtures/sample-site/` through a test helper that serves it on port 0 and adds in-memory routes (robots.txt, a 503 home, an injection page, an external link). It already has the 404 Calendar link and the backend form, and the frozen `10-inventory.json` becomes the expected answer. Nothing under `contracts/` is edited.

## Per task

### T07 Orchestrator stub mode: CHANGE (plan.md T07, edited)
- Problem: step 3 ("if the lane CLI exists and `--stub` is not forced, call it") is T17's job. On Monday, `lanes/b-design/cli.mjs` may already exist on main, so T07's test would run another lane's code and pass or fail on their work. Also, copied fixtures carry `run_id: sample-0001`, so the new run fails `crossErrors` ("run_id differs across files") unless the stub rewrites it.
- New files: `orchestrator/cli.mjs`, `orchestrator/lib/run.mjs`, `orchestrator/lib/select.mjs`, `orchestrator/test/stub.test.mjs`, `orchestrator/package.json` (no dependencies); modify `.github/workflows/ci.yml` (orchestrator job runs `cd contracts && npm ci` first).
- New failing test: `node orchestrator/cli.mjs run --stub --fixture contracts/fixtures/sample --out-dir <tmp>` creates `<tmp>/<run_id>/` with all seven contract files plus the fixture's `a-scout/`, `b-design/`, `c-build/` folders, every file carries the new `run_id`, `crossErrors(runDir)` returns [], the log has one `STUB <stage>` line per stage, exit 0; a fixture folder missing `30-directions.json` exits 1 naming the file.
- New done: `cd contracts && npm ci` once, then `cd orchestrator && node --test` passes on Node 20.13 locally and in CI on 24.

### T08 Scout crawl and text blocks: CHANGE (plan.md T08, edited)
- Problems: a second fixture site duplicates the sample site; sitemap support is speculative; Ajv in a-scout is not approved; the output cannot validate until T09 adds screenshots (required fields with path patterns); `/` and `/index.html` would be crawled as two pages (the nav links to `/index.html`); and Scout cannot write `status: "fail"`.
- New files: `lanes/a-scout/cli.mjs`, `scout/crawl.mjs`, `scout/blocks.mjs`, `test/serve.mjs`, `test/crawl.test.mjs`; modify `.github/workflows/ci.yml` (a-scout job: `cd contracts && npm ci`, then `npx playwright install --with-deps chromium`). No new fixture site.
- Screenshots move here from T09 (two lines once the page is open), so T08's output validates on its own.
- New failing test: listed in plan.md T08 (a) to (h): three pages p01 to p03 with depths 0, 1, 1; Calendar in failures; block text and kind match the frozen fixture with nav and footer excluded; robots Disallow honoured with no request made; stable ids; schema valid with forward slashes; `max_pages: 2` gives 2 pages; a 503 home exits 3 with no 10-inventory.json and the reason in `a-scout/failure.json`.
- Rule for fixture mismatches: if a hand-written fixture choice cannot be reproduced by a simple rule, the builder names that block in the test and excludes it; nobody edits the frozen fixture.
- New done: `cd lanes/a-scout && node --test` passes.

### T09 Scout images, links, forms: CHANGE (plan.md T09, edited)
- Smaller: screenshots moved to T08. Images are element screenshots (no second download, works for SVG). `needs_backend` is always true this week, since the output is a static Astro site with no backend. Links keep `href` as written in the HTML (the fixture uses `/index.html`, not absolute URLs).
- New failing test: in plan.md T09 (crest image entry and file, four internal nav links, an external link recorded but never navigated, form p03-f01 with three labelled fields).

### T16 Scout brand, facts, injection safety: CHANGE (plan.md T16, edited)
- Cut dembrandt (computed styles instead). Cut `person` and `price` facts this week: no reliable rule exists, and a missing fact only means the fact diff checks less; it never fails a build by mistake. Facts are regex rules over block text (phone, email, date, time, address, legal_notice by keyword label).
- Rewrite the injection assertion. "The crawler makes no request outside the target host" cannot pass: Chromium loads third-party images, fonts and scripts while rendering. Testable version: Scout never **navigates** to a non-target host, and writes nothing outside `10-inventory.json` and `a-scout/`.
- Honest scoping for C7: Scout makes no model calls, so text cannot steer it by construction. The real injection exposure is in Lanes B and C, which feed these blocks to models (see BOARD ask).
- Injection page is an in-memory route in `test/serve.mjs`, not a new fixture file. Approved installs: none.

### T17 Orchestrator real mode and operator pick: CHANGE (plan.md T17 and Interfaces line 64, edited)
- Takes over "call the lane CLI if present, else the fixture with `STUB <stage> (lane not present)`". Adds `--lanes-root` (default `lanes/`) so tests use fake CLIs and never real lanes.
- One rule for exits instead of a list: any nonzero exit (1, 2, 3, 4) stops the run, prints stage, owner, the meaning of the code and the input paths, and the orchestrator exits with the same code. A stage that exits 0 but writes an invalid file stops with exit 2.
- Spawn with `spawnSync(process.execPath, [cli, ...args])`, no shell: same Node version as the orchestrator, and paths with spaces are safe on Windows.
- Cut the interactive prompt: `--pick dN` only. Without it, `needs_human: true` uses the council pick and logs how to override.

### T24 Integration readiness check: KEEP, one addition (not edited)
- Add a dry run Tue 21:00 PST on main, so Wed 09:00 is a re-run, not the first time anyone sees a failure. Report a missing `node_modules` or missing Chromium in a lane as a setup failure @ that owner, not a lane bug. Abhinav never runs `npm ci` in another lane's folder.

### T25 First real-site run: CHANGE (plan.md T25, edited)
- Add consent gates: Vidyut's standing rule is no requests to live production URLs without asking, so crawling Prism production needs his yes first; the school site needs written owner consent recorded in `00-run.json consent.note`. Use `waitUntil: "load"` with a 30 s timeout (set in T08), because `networkidle` hangs on analytics-heavy school sites.

### T26 Plain Claude baseline: KEEP (not edited)
- Needed for claim C6 on Thursday. Run it after T25 on Wed; it must not block the real run.

## Missing (would break the Wed run if ignored)
1. **contracts/node_modules.** The orchestrator, Scout and the readiness test import `contracts/validate.mjs`; on a fresh clone or CI job they crash with "Cannot find package 'ajv'" until `cd contracts && npm ci` runs. Now in T07 and T08 done criteria and CI steps.
2. **Chromium in CI.** Playwright the package is installed; the browser is a separate download (`npx playwright install --with-deps chromium`). @main: confirm with Vidyut that the Playwright approval covers this CI browser download.
3. **Node 20.13 locally versus 24 in CI.** Added a Global Constraints line: no `fs.glob`, no `require()` of ESM, no type stripping, no `Array.fromAsync`, no glob arguments to `node --test` (Node 20 does not expand them and Windows shells do not either); bare `node --test` only. `import.meta.dirname` and global `fetch` are fine on both.
4. **Windows paths.** Use `node:path` for disk paths and `path.posix` (or literal `/`) for every path written into a contract. The schema rejects backslashes, so the T08 (f) assertion catches a slip. Run ids `YYYYMMDD-HHMM-<slug>` contain no colons, which keeps them legal folder names on Windows.
5. **Doc drift (not edited, Abhinav's call).** `plan/lanes.md` line 30 and `contracts/validate.mjs` line 4 say lanes never run validate.mjs. With this audit, Lane A's own Scout imports it (same owner, saves an Ajv install). Lanes B and C still use their own Ajv. Update lanes.md line 30 to "orchestrator, CI and Lane A's Scout" when convenient; contracts/ stays untouched until the next version bump.
6. Optional: a root `.gitattributes` with `* text=auto eol=lf` and `*.png binary` stops CRLF noise from Abhinav's Windows checkout. Low risk either way, since tests compare parsed JSON and rendered text.
7. Screenshot width: T08 uses 1440 (from the plan); the frozen fixture used 1280. Nothing reads the width, so the plan wins; noted so nobody "fixes" one to match the other mid-week.

## Build order (shortest path)
| When (PST) | Task | Gate |
|---|---|---|
| Mon, first, about 60 min | T07 stub mode | **stub chain exits 0**, board line posted; nothing else in Lane A blocks this |
| Mon, about 90 min | T08 crawl, blocks, screenshots | real Scout output on the sample site validates (pages, blocks, failures) |
| Mon evening or Tue morning, about 45 min | T09 images, links, forms | full pages[] |
| Tue, first, about 60 min | T17 real mode and `--pick` | independent of Scout; T24 needs it |
| Tue, about 75 min | T16 facts, brand, injection | **complete real inventory.v1 Tuesday** |
| Tue 21:00 | T24 written and dry-run on main | failures posted @lane-b / @lane-c overnight |
| Wed 09:00 | T24 re-run | all five stages exit 0 on the sample |
| Wed | T25 (after Vidyut's yes for Prism) then T26 | one real run reaches 50-handoff.json |

## Strengths to keep
Frozen contracts with a cross validator that already passes; one CLI shape and exit-code table for every lane; readiness defined as "stage command on the sample exits 0 and validates"; the crawl limits (robots, 40 pages, 1 rps, named user agent).

## The one change to make first
Split T07 from T17 as edited: stub mode never looks in `lanes/`, so Monday's gate depends only on Lane A's code and the frozen fixtures.
