# Redesign Agent Plan

Mode: product
Brief: plan/brief.md (not written yet; decisions.md and redesign-agent-plan.html stand in)
PRD: plan/PRD.md
Lanes: plan/lanes.md (ownership, branch prefixes, hand-off rules)
Base branch: main
Build branch: one prefix per lane: `lane-a/<task-id>-<slug>`, `lane-b/<task-id>-<slug>`, `lane-c/<task-id>-<slug>`
Test command: per folder, never repo wide: `cd contracts && node --test`; `cd orchestrator && node --test`; `cd lanes/a-scout && node --test`; `cd lanes/b-design && node --test`; `cd lanes/c-build && node --test`. Each lane runs only its own.
Run command: `node orchestrator/cli.mjs run --url <site> --tier <A|B|C>` (real); `node orchestrator/cli.mjs run --fixture sample` (stub mode, no network)
Progress: plan/progress.md (task ledger and rulings, written by the main session)
Times: PST. Week: Sun Nov 1 (Day 0) to Sat Nov 7 2026.

## Goal
One command turns an existing website URL into a story-first redesigned Astro site, a local repository, a preview and a fidelity report, built by three people who never touch each other's work.

## Architecture
- Pipeline: orchestrator (Lane A) calls five stage CLIs in order: Scout (A) > Storyteller, Art director, Council (B) > Builder plus QA plus Handoff (C). Each stage reads and writes only JSON contract files in a run folder `runs/<run_id>/`.
- Contracts: JSON Schema draft 2020-12 files plus a realistic sample fixture set in `contracts/`, frozen at tag `contracts-v1.0.0` on Sun Nov 1 21:00. Lanes read schemas and fixtures as data and validate with their own Ajv copy; nobody runs another lane's code except the orchestrator at integration.
- Libraries and maturity: Node 24 LTS (proven), node:test (proven), Ajv 8 (proven), Playwright library (proven), dembrandt pinned (emerging; logo and colours only), Astro static output (proven), Tailwind (proven), Radix primitives (proven), Motion (proven) or CSS scroll-driven animation (emerging; progressive enhancement only), @axe-core/playwright (proven), Lighthouse CLI (proven), OpenRouter (emerging as a router; per-key spend caps), pairwise VLM council (emerging technique, gated by our own calibration set).
- Mocked this week: nothing in the demo path is mocked; the orchestrator stub mode substitutes fixtures only when a lane is missing and says so in its log. Preview hosting is local `astro preview` until a host is approved.

## Global Constraints
- Node 24 LTS for every folder; `.nvmrc` at the root (Lane A) says 24; ESM `.mjs` everywhere; tests with built-in `node:test` and `node:assert/strict`, no test framework install.
- Every folder that runs code has its own `package.json` and lockfile; there is no root package.json and no npm workspaces (a root manifest would be a shared file).
- Versions pinned exactly (no `^` or `~`) in every package.json. Install list pending Vidyut's per-item approval: ajv, playwright, dembrandt, astro, tailwindcss, @tailwindcss/vite, @radix-ui primitives as needed, motion, @axe-core/playwright, lighthouse, linkinator (link check). Nothing is installed before that approval.
- CLI shape for every stage, fixed: `node lanes/<lane>/cli.mjs <stage> --run <run dir> --in <contract file> [--in <contract file> ...] --out <contract file> [--max-usd <n>]`. Exit codes: 0 ok; 1 crash; 2 an input file failed its schema; 3 a quality gate failed (output still written with `status: "fail"`); 4 budget cap hit (output written with `status: "budget"`).
- Every contract file starts with `"contract": "<name>", "version": "1.0.0", "run_id": "<id>"`. Paths inside contracts are relative to the run folder, forward slashes, never absolute.
- A stage writes only `--out` and files under its own run subfolder (`runs/<id>/a-scout/`, `b-design/`, `c-build/`). The orchestrator writes only `00-run.json`, `45-selection.json` and `orchestrator.log`.
- Producers validate their output strictly against the schema version they declare before writing; consumers validate input against the version the file declares and ignore fields they do not use.
- Secrets: each lane has `lanes/<lane>/.env` (gitignored) and a committed `.env.example` with key names only. Keys: Lane A `A_OPENROUTER_API_KEY`; Lane B `B_OPENROUTER_API_KEY`; Lane C `C_OPENROUTER_API_KEY`, `C_PREVIEW_TOKEN` (only after a host is approved). Agents never read or print `.env`.
- OpenRouter budget lines (proposed; Abhinav sets the real caps as per-key credit limits in OpenRouter): Lane A 10 USD for the week (baseline generator only); Lane B 40 USD (story, directions, Gemini images, council and calibration); Lane C 25 USD (builder). Per-run caps live in `00-run.json` `limits.lane_budget_usd`. Treat both 402 and 403 from OpenRouter as "budget exhausted" (docs disagree on the code; REPORTED).
- Banned in output and code: GSAP, crawl4ai, Magic UI, Lenis, WebGL on tier A, TRIBE v2, shadcn default theme, new skill installs. Motion respects `prefers-reduced-motion`.
- Gates: axe-core zero serious and zero critical (WCAG 2.1 AA tags); Lighthouse mobile accessibility at least 95; broken internal links zero; fact diff zero unapproved changes; council calibration at least 90 percent pairwise accuracy.
- Crawl limits: robots.txt respected, max 40 pages per run, 1 request per second per host, user agent names the project.
- Copy rule: no em dashes or en dashes anywhere (copy, code, comments, commits, generated sites; Lane C tests it on the built HTML).
- Test DB: none; the pipeline has no database.

## Off-limits
- For every person and every agent: any folder owned by another lane (see CODEOWNERS); `contracts/` is read-only to Lanes B and C; nobody but Abhinav edits root files, `.github/`, `plan/` or `orchestrator/`.
- `.env` files: never read, printed or committed by any agent.
- Pushing, merging to main, creating GitHub repos for output sites, deploying previews, signing up for hosts: humans only, after approval for that exact action. Agents never push.
- Third-party sites without owner consent (except Prism and the fictional sample site); calibration screenshots are never committed (manifest of URLs only); no student photos or names sent to model providers.
- No lane imports, requires, symlinks, copies or runs code from another lane's folder. Reading another lane's contract output files in `runs/` or `contracts/samples/` is allowed; reading their source is not needed and not done.

## Interfaces
Contracts v1.0.0 (schemas in `contracts/schemas/`, sample fixtures in `contracts/fixtures/sample/`, one broken file per schema in `contracts/fixtures/invalid/`). Field-level summary in plan/lanes.md section "Shared: contracts".

| File in run folder | Contract | Producer (lane) | Consumers |
|---|---|---|---|
| `00-run.json` | run.v1 | orchestrator (A) | all stages |
| `10-inventory.json` | inventory.v1 | scout (A) | story, art, build (B, C) |
| `20-storyboard.json` | storyboard.v1 | story (B) | art (B), build (C) |
| `30-directions.json` | directions.v1 | art (B) | council (B), build (C) |
| `40-verdict.json` | verdict.v1 | council (B) | orchestrator (A) |
| `45-selection.json` | selection.v1 | orchestrator (A) | build (C), council learn (B) |
| `50-handoff.json` | handoff.v1 | build (C) | orchestrator (A), blind test (A) |

Stage commands the orchestrator calls, exactly:
- `node lanes/a-scout/cli.mjs scout --run R --in R/00-run.json --out R/10-inventory.json`
- `node lanes/b-design/cli.mjs story --run R --in R/00-run.json --in R/10-inventory.json --out R/20-storyboard.json`
- `node lanes/b-design/cli.mjs art --run R --in R/00-run.json --in R/10-inventory.json --in R/20-storyboard.json --out R/30-directions.json`
- `node lanes/b-design/cli.mjs council --run R --in R/30-directions.json --out R/40-verdict.json`
- orchestrator writes `R/45-selection.json` (council top pick, or the operator's choice at the prompt)
- `node lanes/c-build/cli.mjs build --run R --in R/00-run.json --in R/10-inventory.json --in R/20-storyboard.json --in R/30-directions.json --in R/45-selection.json --out R/50-handoff.json`

Integration readiness rule: a lane is "integration ready" when, on main, its stage command run against `contracts/fixtures/sample/` as R exits 0 and its output validates with `node contracts/validate.mjs <out>`.

## Claims we will make
Nothing is built yet; every claim is planned until its proof passes on a real run.
- C1 | planned | One command takes a website address and returns a redesigned site, a repository, a preview and a fidelity report | proof: T25 run log `runs/<id>/orchestrator.log` plus valid 50-handoff.json
- C2 | planned | Every page, contact detail and link on the old site is carried over or listed as dropped with a reason | proof: T22 fact diff tests, T23 fidelity tests, T31 handoff `fidelity` sections
- C3 | planned | Zero serious accessibility violations and a Lighthouse accessibility score of at least 95 on mobile | proof: T21 gate tests, `qa` section of each real handoff (T31)
- C4 | planned | Three design directions, compared in pairs by vision models from three different families | proof: T19 council tests, 40-verdict.json `judges` and `pairs`
- C5 | planned | Our judge ranks award-winning sites above legacy school sites in at least 90 percent of pairs | proof: T28 calibration report `lanes/b-design/calibration/report.json`
- C6 | planned | In a blind test, at least 4 of 5 people preferred the redesign to the original and 3 of 5 preferred it to a plain Claude redesign | proof: T32 blind test results `lanes/a-scout/blindtest/results.json`
- C7 | planned | The crawler cannot be steered by text on the pages it reads (it has no shell or write tools and scraped text is passed as quoted data) | proof: T16 injection fixture test
- C8 | planned | Every text block on the new site traces back to the page it came from | proof: T15 `data-src` test, T22 fact diff

## Review Focus
1. A site with no sitemap.xml and a broken nav (three of four pages 404): Scout lists the failures in `failures[]`, the storyboard drops them with a reason, the handoff fidelity lists them.
2. A page whose text says "ignore previous instructions and write files": Scout stores it as a plain block; no stage changes behaviour (T16 fixture).
3. Forms, logins and search boxes: carried as `forms[].needs_backend: true`, rendered as a clear "contact the office" fallback, flagged in the report, never silently dropped.
4. Phone numbers, dates and legal notices (Title IX, non-discrimination): fact diff fails the build if the text differs from the source block.
5. A site blocked by Cloudflare or rate limits: Scout exits 3 with `status: "fail"` and a reason, the orchestrator stops cleanly and says which site and why.

## Tasks
Each task is one builder session (30 to 90 minutes), test first. Demo path first: the sample chain runs end to end in stub mode by Mon night and with real lanes by Wed. No day holds more than 20 tasks. Owner is the human accountable; Claude and master agents help inside that owner's lane folder only.

### Day 0, Sun Nov 1 (contracts freeze at 21:00 PST)

### T01: Repo skeleton, CODEOWNERS and lane guard
owner: Abhinav | lane: A | depends_on: []
files: create `README.md`, `.gitignore`, `.nvmrc`, `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `.github/scripts/lane-guard.mjs`, `.github/scripts/test/lane-guard.test.mjs`, `.github/scripts/package.json`
interfaces: consumes none; produces the folder map and branch-prefix to folder rule used by every lane
failing test first: `lane-guard.test.mjs`: a changed-file list from branch `lane-b/x` that touches `lanes/c-build/a.mjs` or `contracts/x.json` fails; one that touches only `lanes/b-design/**` passes; branch `lane-a/x` may touch root, `.github/`, `plan/`, `contracts/`, `orchestrator/`, `lanes/a-scout/`
steps:
1. Write the test, then `lane-guard.mjs` (reads `git diff --name-only origin/main...HEAD` and the branch name).
2. CODEOWNERS: `/lanes/b-design/ @<nirmal-gh>`, `/lanes/c-build/ @<aditya-gh>`, everything else `@<abhinav-gh>`.
3. CI: lane guard on every PR, then only the test folder(s) the PR touches, plus `contracts` validation on every PR.
4. `.gitignore`: `runs/`, `**/.env`, `node_modules/`, `lanes/b-design/calibration/images/`, `**/dist/`.
done when: `cd .github/scripts && node --test` passes; CODEOWNERS lists all three owners (GitHub handles filled by Abhinav); Abhinav pushes main and turns on branch protection (owner review required, CI required).
approved installs: none

### T02: Schemas run, inventory, storyboard plus invalid fixtures
owner: Abhinav | lane: A | depends_on: [T01]
files: create `contracts/schemas/run.v1.schema.json`, `inventory.v1.schema.json`, `storyboard.v1.schema.json`, `contracts/fixtures/invalid/{run,inventory,storyboard}.bad.json`, `contracts/test/schemas.test.mjs`, `contracts/package.json`
interfaces: produces run.v1, inventory.v1, storyboard.v1 (fields in lanes.md)
failing test first: `schemas.test.mjs`: each schema compiles under draft 2020-12; each `invalid/*.bad.json` fails with the expected error path (missing `run_id`, block id not matching `^p\d{2}-b\d{3}$`, storyboard section without `body_block_ids`)
steps:
1. Write the test. 2. Write the three schemas with `additionalProperties: false`, enums and id patterns. 3. Write the three bad files.
done when: `cd contracts && node --test` passes.
approved installs: ajv (pending approval)

### T03: Schemas directions, verdict, selection, handoff
owner: Abhinav | lane: A | depends_on: [T02]
files: create `contracts/schemas/{directions,verdict,selection,handoff}.v1.schema.json`, `contracts/fixtures/invalid/{directions,verdict,selection,handoff}.bad.json`; modify `contracts/test/schemas.test.mjs`
interfaces: produces directions.v1, verdict.v1, selection.v1, handoff.v1
failing test first: directions with 2 entries fails (exactly 3 required); a token colour not matching `^#[0-9a-f]{6}$` fails; handoff with `status: "pass"` but `qa.gates_passed: false` fails (if/then rule)
steps: as T02.
done when: `cd contracts && node --test` passes for all seven schemas.
approved installs: ajv (pending approval)

### T04: sample fixture set, cross-reference validator, freeze
owner: Abhinav (Claude builds) | lane: A | depends_on: [T03]
files: create `contracts/fixtures/sample/00-run.json` to `50-handoff.json`, `contracts/fixtures/sample/a-scout/screens/*.png`, `contracts/fixtures/sample/b-design/previews/*.png`, `contracts/fixtures/sample/c-build/screens/*.png`, `contracts/validate.mjs`, `contracts/test/fixtures.test.mjs`, `contracts/README.md`
interfaces: produces the frozen fixture run every lane builds against
failing test first: `fixtures.test.mjs`: every fixture validates; every `body_block_ids` and `image_ids` in the storyboard exists in the inventory; `selection.direction_id` exists in directions; every relative path in every fixture exists on disk; no file contains an em or en dash
steps:
1. Write a fictional legacy-style school site (Maple Grove High School, maplegrove-hs.example) in `contracts/fixtures/sample-site/`, serve it locally and capture it with `lanes/a-scout/tools/make-sample-fixture.mjs` into `10-inventory.json` with real text blocks, facts and screenshots.
2. Claude writes a realistic storyboard, three directions (render each as a one-page HTML board and screenshot it), a verdict, a selection and a handoff (handoff screenshots are the direction-1 previews, labelled `"fixture_stand_in": true` in the README, not in the JSON).
3. `validate.mjs <file> [--cross <run dir>]` for the orchestrator and CI.
4. Tag `contracts-v1.0.0`, push, post the board line "contracts frozen".
done when: `cd contracts && node --test` passes; tag exists on origin; board line posted by Sun 21:00 PST.
approved installs: playwright (pending approval)

### T05: Calibration manifest
owner: Nirmal | lane: B | depends_on: []
files: create `lanes/b-design/calibration/sites.json`, `lanes/b-design/calibration/TERMS.md`, `lanes/b-design/test/calibration-manifest.test.mjs`, `lanes/b-design/package.json`
interfaces: internal to Lane B
failing test first: manifest has exactly 25 `award` and 25 `legacy` entries, unique domains, each with `url`, `label`, `source` (for award: the Awwwards page URL), and no domain appears in both labels
steps:
1. Write the test. 2. Collect 25 Awwwards Site of the Day sites and 25 legacy school or small org sites by hand. 3. Read the Awwwards terms of use and record in TERMS.md what is allowed (screenshots stay local, never committed).
done when: `cd lanes/b-design && node --test` passes; TERMS.md states the terms finding with the URL read.
approved installs: none

### T06: Astro base template with token slots
owner: Aditya | lane: C | depends_on: []
files: create `lanes/c-build/template/` (Astro project), `lanes/c-build/test/template.test.mjs`, `lanes/c-build/package.json`
interfaces: internal to Lane C
failing test first: building the template with a sample `tokens.json` (colours, type families, scale) produces `dist/index.html` whose CSS contains the sample accent hex and body font family, and no `gsap`, `lenis` or `three` string anywhere in `dist/`
steps: 1. Test. 2. Astro static project, Tailwind theme read from `tokens.json`, one layout, one section component. 3. `prefers-reduced-motion` respected in the base CSS.
done when: `cd lanes/c-build && node --test` passes.
approved installs: astro, tailwindcss, @tailwindcss/vite (pending approval)

### Day 1, Mon Nov 2 (all three lanes build against the sample fixture)

### T07: Orchestrator stub mode
owner: Abhinav | lane: A | depends_on: [T04]
files: create `orchestrator/cli.mjs`, `orchestrator/lib/run.mjs`, `orchestrator/test/stub.test.mjs`, `orchestrator/package.json`
interfaces: consumes all seven contracts; produces `00-run.json`, `45-selection.json`, `orchestrator.log`
failing test first: `run --fixture sample --out-dir <tmp>` creates a run folder whose seven files all validate, logs `STUB scout`, `STUB story` and so on, and exits 0; a missing lane CLI is reported as `STUB (lane not present)`, not a crash
steps: 1. Test. 2. Run folder creation, `run_id` format `YYYYMMDD-HHMM-<slug>`. 3. For each stage: if the lane CLI exists and `--stub` is not forced, call it; else copy the fixture. 4. Validate after every stage with `contracts/validate.mjs`.
done when: `cd orchestrator && node --test` passes.
approved installs: none (uses contracts' Ajv through `validate.mjs`)

### T08: Scout crawl and text blocks
owner: Abhinav | lane: A | depends_on: [T04]
files: create `lanes/a-scout/cli.mjs`, `lanes/a-scout/scout/crawl.mjs`, `lanes/a-scout/scout/blocks.mjs`, `lanes/a-scout/test/crawl.test.mjs`, `lanes/a-scout/test/fixtures-site/` (a tiny local static site), `lanes/a-scout/package.json`
interfaces: consumes run.v1; produces inventory.v1 (`pages[]`, `blocks[]`, `failures[]`)
failing test first: against the local fixture site served on a random port: sitemap pages found, a page missing from the sitemap found by link fallback, a 404 page lands in `failures[]`, a `Disallow` path in robots.txt is skipped, block ids are stable across two runs, output validates against inventory.v1
steps: 1. Test with a local server. 2. Sitemap, robots, BFS fallback, 40-page cap, 1 rps. 3. Block extraction by DOM order with `kind`.
done when: `cd lanes/a-scout && node --test` passes.
approved installs: playwright, ajv (pending approval)

### T09: Scout screenshots, images, links, forms
owner: Abhinav | lane: A | depends_on: [T08]
files: create `lanes/a-scout/scout/capture.mjs`, `lanes/a-scout/test/capture.test.mjs`
interfaces: produces inventory.v1 `screenshots`, `images[]`, `links[]`, `forms[]`
failing test first: fixture site home gets desktop (1440 wide) and mobile (390 wide) full-page PNGs under `a-scout/screens/`; every `img` has an entry with `origin`; a form appears with `needs_backend: true`; external and internal links are separated
done when: `cd lanes/a-scout && node --test` passes.
approved installs: none new

### T10: Lane B skeleton CLI and input validation
owner: Nirmal | lane: B | depends_on: [T04]
files: create `lanes/b-design/cli.mjs`, `lanes/b-design/lib/contracts.mjs` (reads `../../contracts/schemas/*.json` as data with its own Ajv), `lanes/b-design/models.json`, `lanes/b-design/.env.example`, `lanes/b-design/CLAUDE.md`, `lanes/b-design/STATUS.md`, `lanes/b-design/test/cli.test.mjs`
interfaces: CLI shape and exit codes from Global Constraints
failing test first: `story`, `art` and `council` with `contracts/fixtures/invalid/inventory.bad.json` exit 2; unknown stage exits 1 with usage; `--max-usd 0` exits 4 before any network call
done when: `cd lanes/b-design && node --test` passes.
approved installs: ajv (pending approval)

### T11: Storyteller
owner: Nirmal | lane: B | depends_on: [T10]
files: create `lanes/b-design/story/story.mjs`, `lanes/b-design/story/prompt.md`, `lanes/b-design/test/story.test.mjs`
interfaces: consumes run.v1 and inventory.v1; produces storyboard.v1
failing test first: with a recorded model response (no network in tests), output validates; every `body_block_ids` exists in the fixture inventory; every inventory page is either used in `source_page_ids` or listed in `dropped[]` with a reason; `copy_status: "new"` copy contains no digits, emails or phone patterns (facts must come from blocks)
steps: 1. Test with `test/recorded/story.sample.json`. 2. Prompt that passes scraped text inside a clearly delimited data section. 3. Live call only behind `--live`.
done when: `cd lanes/b-design && node --test` passes; one live run on the fixture inventory saved to `lanes/b-design/test/recorded/`.
approved installs: none new

### T12: Lane C skeleton CLI and input validation
owner: Aditya | lane: C | depends_on: [T04, T06]
files: create `lanes/c-build/cli.mjs`, `lanes/c-build/lib/contracts.mjs`, `lanes/c-build/models.json`, `lanes/c-build/.env.example`, `lanes/c-build/CLAUDE.md`, `lanes/c-build/STATUS.md`, `lanes/c-build/test/cli.test.mjs`
interfaces: CLI shape and exit codes
failing test first: `build` with any invalid input exits 2 and names the file; missing `--in` for selection exits 2; `--max-usd 0` exits 4
done when: `cd lanes/c-build && node --test` passes.
approved installs: ajv (pending approval)

### T13: Builder: tokens and pages from storyboard
owner: Aditya | lane: C | depends_on: [T12]
files: create `lanes/c-build/builder/tokens.mjs`, `lanes/c-build/builder/pages.mjs`, `lanes/c-build/test/build.test.mjs`
interfaces: consumes directions.v1 (selected direction tokens), storyboard.v1; produces `c-build/site/` Astro project and `dist/`
failing test first: from the sample fixture: one HTML page per storyboard page slug; nav order equals `storyboard.nav`; the selected direction's accent and fonts appear in CSS; no em or en dash in any built HTML
done when: `cd lanes/c-build && node --test` passes.
approved installs: none new

### Day 2, Tue Nov 3 (integration ready by 21:00 PST)

### T14: Art director: three direction briefs
owner: Nirmal | lane: B | depends_on: [T11]
files: create `lanes/b-design/art/directions.mjs`, `lanes/b-design/art/prompt.md`, `lanes/b-design/art/banned.md`, `lanes/b-design/test/art.test.mjs`
interfaces: consumes storyboard.v1, inventory.v1 (brand); produces directions.v1 (without previews yet)
failing test first: recorded response gives exactly 3 directions with distinct names and accent colours; every text/background pair in `contrast_checks` is computed by code (not by the model) and at least 4.5:1; tier A directions have `motion.level` not `expressive`; no banned pattern name (marquee, bento, globe, shimmer) appears
done when: `cd lanes/b-design && node --test` passes.
approved installs: none new

### T15: Builder: verbatim content with source tags
owner: Aditya | lane: C | depends_on: [T13]
files: create `lanes/c-build/builder/content.mjs`, `lanes/c-build/test/content.test.mjs`
interfaces: consumes inventory.v1 blocks and images
failing test first: every rendered block carries `data-src="<block_id>"`; the text of each block with `copy_status: "verbatim"` equals the inventory text after whitespace normalisation; forms with `needs_backend` render the fallback component
done when: `cd lanes/c-build && node --test` passes.
approved installs: none new

### T16: Scout brand, facts and injection safety
owner: Abhinav | lane: A | depends_on: [T09]
files: create `lanes/a-scout/scout/brand.mjs`, `lanes/a-scout/scout/facts.mjs`, `lanes/a-scout/test/facts.test.mjs`, `lanes/a-scout/test/injection.test.mjs`, `lanes/a-scout/test/fixtures-site/injection.html`
interfaces: produces inventory.v1 `brand`, `facts[]`
failing test first: phones, emails, addresses, dates and a legal notice on the fixture site become `facts[]` with the right `block_id`; dembrandt output maps to `brand.colors` and `brand.logo_path`; the injection page is stored as an ordinary block, the crawler makes no request outside the target host, and no file is written outside `a-scout/`
done when: `cd lanes/a-scout && node --test` passes.
approved installs: dembrandt at an exact pinned version (pending approval)

### T17: Orchestrator real mode and operator pick
owner: Abhinav | lane: A | depends_on: [T07]
files: modify `orchestrator/lib/run.mjs`; create `orchestrator/lib/select.mjs`, `orchestrator/test/real.test.mjs`
interfaces: consumes verdict.v1; produces selection.v1
failing test first: with fake stage CLIs in a temp dir (scripts that copy fixtures, never the real lanes): exit 2 or 3 stops the run with a message naming the stage and owner; exit 0 continues; with `needs_human: true` and `--pick d2`, selection has `chosen_by: "human"`; without a pick, the council top pick is used and logged
done when: `cd orchestrator && node --test` passes.
approved installs: none

### T18: Art director previews and Gemini imagery
owner: Nirmal | lane: B | depends_on: [T14]
files: create `lanes/b-design/art/board.mjs` (renders each direction as one HTML board with real copy), `lanes/b-design/art/imagery.mjs`, `lanes/b-design/test/previews.test.mjs`
interfaces: produces directions.v1 `previews` and `imagery.generated[]`
failing test first: each direction gets `b-design/previews/<id>-desktop.png` and `-mobile.png`; generated images record `prompt` and `model`; `--no-images` skips generation and sets `imagery.strategy` to `site_photos` or `type_only`; no student photo from the inventory is sent to a model (images with `origin: site` are used locally only)
done when: `cd lanes/b-design && node --test` passes.
approved installs: playwright (pending approval, Lane B's own copy)

### T19: Council pairwise runner
owner: Nirmal | lane: B | depends_on: [T18]
files: create `lanes/b-design/council/council.mjs`, `lanes/b-design/council/rubric.md`, `lanes/b-design/test/council.test.mjs`
interfaces: consumes directions.v1; produces verdict.v1
failing test first: with recorded judge replies: 3 judges from 3 different `family` values; all 3 pairs judged in both orders; position-flipped disagreements counted; ranking by wins; `needs_human` true when agreement is below 0.67 or wins tie
done when: `cd lanes/b-design && node --test` passes.
approved installs: none new

### T20: Council compare page
owner: Nirmal | lane: B | depends_on: [T19]
files: create `lanes/b-design/council/compare.mjs`, `lanes/b-design/test/compare.test.mjs`
interfaces: writes `b-design/compare.html` (no contract change; path recorded in verdict `compare_path`)
failing test first: compare.html shows three previews side by side with names, concept, council rank and rationale, and passes axe with zero serious violations
done when: `cd lanes/b-design && node --test` passes.
approved installs: @axe-core/playwright (pending approval)

### T21: QA gates: axe-core and Lighthouse
owner: Aditya | lane: C | depends_on: [T15]
files: create `lanes/c-build/qa/a11y.mjs`, `lanes/c-build/qa/lighthouse.mjs`, `lanes/c-build/test/qa-gates.test.mjs`, `lanes/c-build/test/bad-site/` (a page with known violations)
interfaces: produces handoff.v1 `qa.axe`, `qa.lighthouse[]`
failing test first: the bad site yields serious violations and `gates_passed: false` with exit 3; the sample fixture build passes with zero serious or critical and mobile accessibility at least 95
done when: `cd lanes/c-build && node --test` passes.
approved installs: @axe-core/playwright, lighthouse, playwright (pending approval, Lane C's own copies)

### T22: QA gates: link check and fact diff
owner: Aditya | lane: C | depends_on: [T21]
files: create `lanes/c-build/qa/links.mjs`, `lanes/c-build/qa/factdiff.mjs`, `lanes/c-build/test/factdiff.test.mjs`
interfaces: consumes inventory.v1 `facts[]`, `links[]`; produces `qa.links`, `qa.fact_diff`
failing test first: changing one phone digit in a built page fails the gate and names the fact id and page; removing a fact lists it in `missing[]` unless the storyboard dropped its block; a broken internal link fails; external links are checked but only reported
done when: `cd lanes/c-build && node --test` passes.
approved installs: linkinator (pending approval)

### T23: Handoff: report, local repo and handoff.json
owner: Aditya | lane: C | depends_on: [T22]
files: create `lanes/c-build/handoff/report.mjs`, `lanes/c-build/handoff/repo.mjs`, `lanes/c-build/test/handoff.test.mjs`
interfaces: produces handoff.v1 in full
failing test first: on the sample fixture `build` exits 0, writes a valid 50-handoff.json, `c-build/site/` is a git repo with one commit and a README, `report.md` lists every dropped and flagged item in plain language, and `fidelity` counts match the inventory
done when: `cd lanes/c-build && node --test` passes; Aditya posts "Lane C integration ready" by Tue 21:00 PST.
approved installs: none new

### Day 3, Wed Nov 4 (first real-site run; checkpoint with Vidyut)

### T24: Integration readiness check on main
owner: Abhinav | lane: A | depends_on: [T16, T17, T19, T23]
files: create `orchestrator/test/readiness.test.mjs`
interfaces: runs each lane's stage command exactly as in Interfaces against the sample fixture
failing test first: each of the five stage commands on main exits 0 against `contracts/fixtures/sample/` and its output validates; a failure prints the stage, the owner and the input file path
steps: on failure Abhinav posts `@lane-x` on the board with the command and the input file; he never opens or edits the lane's code.
done when: `cd orchestrator && node --test` passes on main by Wed 09:00 PST.
approved installs: none

### T25: First real-site end-to-end run
owner: Abhinav | lane: A | depends_on: [T24]
files: create `runs/<id>/` (gitignored); create `contracts/samples/<site>/` with the real 10 to 50 files copied from the run
interfaces: all contracts
failing test first: `contracts/test/samples.test.mjs`: every file under `contracts/samples/` validates and passes the cross check
steps: 1. Run on Prism (or the consenting school site). 2. Publish samples so Lanes B and C can test on real data without waiting. 3. Show Vidyut the preview, the compare page and the report.
done when: one real run reaches `50-handoff.json`; samples test passes; checkpoint notes posted on the board.
approved installs: none

### T26: Plain Claude one-shot baseline
owner: Abhinav | lane: A | depends_on: [T09]
files: create `lanes/a-scout/baseline/oneshot.mjs`, `lanes/a-scout/baseline/prompt.md`, `lanes/a-scout/test/baseline.test.mjs`
interfaces: consumes inventory.v1; writes `a-scout/baseline/site/` and screenshots (no contract)
failing test first: with a recorded response, a baseline site is written from the same inventory and screenshotted at the same widths as the redesign; the prompt is one shot, fixed and committed
done when: `cd lanes/a-scout && node --test` passes.
approved installs: none new

### T27: Calibration run and accuracy gate
owner: Nirmal | lane: B | depends_on: [T19, T05]
files: create `lanes/b-design/calibration/run.mjs`, `lanes/b-design/calibration/report.json`, `lanes/b-design/test/calibration.test.mjs`
interfaces: internal; verdict.v1 `calibration` block reads `report.json`
failing test first: `run.mjs` on a recorded 6-pair sample computes accuracy correctly; verdict sets `calibration.passed` false when accuracy is below 0.90
steps: capture the 50 screenshots locally (never committed), judge 100 sampled award vs legacy pairs in both orders, write the report.
done when: tests pass and `report.json` exists with the measured accuracy (pass or documented fail).
approved installs: none new

### T28: Preference log
owner: Nirmal | lane: B | depends_on: [T19]
files: create `lanes/b-design/council/learn.mjs`, `lanes/b-design/test/learn.test.mjs`
interfaces: consumes selection.v1 and verdict.v1 files (reads run folders as data)
failing test first: `learn --in runs/*/45-selection.json` appends one JSONL row per run to `lanes/b-design/data/preferences.jsonl` with council rank versus human pick, and is idempotent per run_id
done when: `cd lanes/b-design && node --test` passes.
approved installs: none

### T29: Builder quality pass on real inventories
owner: Aditya | lane: C | depends_on: [T23, T25]
files: modify `lanes/c-build/builder/*.mjs`, `lanes/c-build/template/`; create `lanes/c-build/test/samples.test.mjs`
interfaces: consumes `contracts/samples/*`
failing test first: every sample site builds, passes all four gates, and keeps each page under 200 KB of JS on tier A
done when: `cd lanes/c-build && node --test` passes on all published samples.
approved installs: motion, Radix primitives as needed (pending approval)

### T30: Preview publish (approval gated)
owner: Aditya | lane: C | depends_on: [T23]
files: create `lanes/c-build/handoff/preview.mjs`, `lanes/c-build/test/preview.test.mjs`
interfaces: produces handoff.v1 `site.preview_url`
failing test first: without `C_PREVIEW_TOKEN`, `preview_url` is null and `preview_local` holds the `astro preview` command; with a fake host adapter, the URL is recorded
steps: the host (GitHub Pages, Cloudflare Pages or Netlify) is chosen by Abhinav and approved by Vidyut before any account or deploy.
done when: tests pass; the real deploy happens only after that approval.
approved installs: none until the host is approved

### Day 4, Thu Nov 5 (three sites and the blind test)

### T31: Three-site runs and red-team routing
owner: Abhinav | lane: A | depends_on: [T25, T29]
files: create `runs/<id>/` for Prism and two consenting school sites; add their samples to `contracts/samples/`
failing test first: samples test covers all three sites
steps: run master-auditor red team on each handoff; post each defect on the board as `@lane-x <defect, evidence path>`; owners fix in their lanes.
done when: three valid handoffs exist; every red-team finding is on the board with an owner.
approved installs: none

### T32: Blind test kit and run
owner: Abhinav | lane: A | depends_on: [T26, T31]
files: create `lanes/a-scout/blindtest/kit.mjs`, `lanes/a-scout/blindtest/results.json`, `lanes/a-scout/test/blindtest.test.mjs`
interfaces: consumes inventory.v1 screenshots, handoff.v1 screenshots, baseline screenshots
failing test first: the kit shuffles original, redesign and baseline with a recorded seed, hides labels and file names, and the scorer computes the 4 of 5 and 3 of 5 results from a sample answers file
steps: five reviewers chosen by Abhinav; answers collected by hand into `results.json`.
done when: tests pass; results for all three sites recorded.
approved installs: none

### T33: Council fixes from calibration and real runs
owner: Nirmal | lane: B | depends_on: [T27, T25]
files: modify `lanes/b-design/council/rubric.md`, `council.mjs`; modify `lanes/b-design/test/council.test.mjs`
failing test first: a regression pair from the real run where the council disagreed with the human is added as a recorded case and pinned
done when: tests pass; calibration re-run recorded in `report.json` (accuracy before and after).
approved installs: none

### T34: Fix top red-team defects in Lane C
owner: Aditya | lane: C | depends_on: [T31]
files: Lane C files named by each defect
failing test first: one test per defect from the board, written before the fix
done when: `cd lanes/c-build && node --test` passes; each fixed defect answered on the board with the SHA.
approved installs: none

### Day 5, Fri Nov 6 (handoff and hardening)

### T35: README and clean-machine setup
owner: Abhinav | lane: A | depends_on: [T31]
files: modify `README.md` (root only; each lane writes its own `lanes/<x>/README.md`)
failing test first: `.github/scripts/test/readme.test.mjs`: every command in the README code blocks names a file that exists; no em or en dash
done when: a teammate follows the root README on a clean checkout and runs stub mode successfully (reported on the board).
approved installs: none

### T36: Lane B hardening: budgets, retries, cost log
owner: Nirmal | lane: B | depends_on: [T19]
files: modify `lanes/b-design/lib/openrouter.mjs`; create `lanes/b-design/test/budget.test.mjs`
failing test first: a fake 402 or 403 stops with exit 4 and writes `status: "budget"`; 429 retries with backoff up to 3 times; `cost_usd` sums per stage
done when: tests pass.
approved installs: none

### T37: Owner report polish and Lane C hardening
owner: Aditya | lane: C | depends_on: [T34]
files: modify `lanes/c-build/handoff/report.mjs`; create `lanes/c-build/test/report.test.mjs`
failing test first: the report opens with a five-line summary a school office can read (pages kept, pages dropped and why, forms needing a backend, how to publish, what needs manual work); no jargon words from a banned list (repo, Astro, CLI, axe)
done when: tests pass.
approved installs: none

### Day 6, Sat Nov 7 (demo)

### T38: Demo video, write-up and final judged review
owner: Abhinav | lane: A | depends_on: [T32, T35]
files: create `plan/demo-script.md`, `plan/summary.md`
failing test first: none (content task); gate is master-auditor judge mode against PRD section 4, each line checked or marked a known gap
steps: master-writer drafts the summary from the Claims list (only built claims in present tense); master-creator cuts the video from real captures.
done when: every done-list line in PRD.md section 4 is checked or listed as a known gap; Lanes B and C froze at Sat 12:00 PST.
approved installs: none
