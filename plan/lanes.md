# Lanes: who owns what (Sun Nov 1 to Sat Nov 7 2026)

Rule (LOCKED, decisions.md line 15): "none of us are going to interact with each other's work in any form or way."
So: three lanes, zero shared files or folders, and every hand-off is a frozen, versioned JSON contract with a schema and a realistic fixture committed on Day 0 (Sun Nov 1, frozen 21:00 PST). Each person can build, test and finish the whole week against fixtures without waiting on, reading, editing or running anyone else's code. The only code that runs another lane's code is the orchestrator, and only Abhinav runs it.
Tasks referenced here are defined in full (files, failing test, done criteria) in plan/plan.md.

## Why this split (changed from the suggested one)
- Storyteller moved from Lane A to Lane B. The storyboard and the three directions are one creative act that iterates together (the story decides the sections, the sections decide the layouts); keeping both in one lane removes the most iterative seam from the contract list. It also balances load: estimated hours from plan.md are Lane A about 21 (4 of them Day 0 contracts nobody else can write, and Abhinav has Claude full time), Lane B about 13, Lane C about 13.
- The plain Claude baseline and the blind test stay with Abhinav, not with the builder. The lane that builds the redesign must not also build the competitor it is judged against.
- Builder, Red team and Handoff stay together in Lane C. They share a built site folder; splitting them across people would need a contract for a whole Astro project, which is the opposite of small.

## Shared (read by everyone, edited only by Abhinav)

### Repo layout
```
redesign-agent/
  README.md                     A   root setup and stub-mode quickstart
  .gitignore  .nvmrc            A   runs/, **/.env, node_modules/, calibration images, dist/
  .github/
    CODEOWNERS                  A   folder to owner map
    workflows/ci.yml            A   lane guard, then only the touched folder's tests, plus contract validation
    scripts/lane-guard.mjs      A   fails a PR whose branch prefix touches another lane's folder
  plan/                         A   PRD.md plan.md lanes.md decisions.md board.md progress.md
  contracts/                    A   FROZEN at tag contracts-v1.0.0
    README.md                       field docs, change-request rule
    schemas/                        run, inventory, storyboard, directions, verdict, selection, handoff (.v1.schema.json)
    fixtures/sample/               00-run.json ... 50-handoff.json plus a-scout/ b-design/ c-build/ images
    fixtures/invalid/               one broken file per schema
    samples/<site>/                 real run outputs Abhinav publishes from Wed (read-only data)
    validate.mjs  test/  package.json   orchestrator and CI only; lanes never run it
  orchestrator/                 A   cli.mjs lib/ test/ package.json
  lanes/
    a-scout/                    A   cli.mjs scout/ baseline/ blindtest/ test/ package.json models.json .env.example CLAUDE.md STATUS.md README.md
    b-design/                   Nirmal   cli.mjs story/ art/ council/ calibration/ data/ lib/ test/ package.json models.json .env.example CLAUDE.md STATUS.md README.md
    c-build/                    Aditya   cli.mjs template/ builder/ qa/ handoff/ lib/ test/ package.json models.json .env.example CLAUDE.md STATUS.md README.md
  runs/                         gitignored; runs/<run_id>/ with 00..50 json files and a-scout/ b-design/ c-build/ subfolders
```
No root package.json, no workspaces, no shared lockfile, no shared config, no shared models file. Each lane installs and pins its own dependencies (Playwright appears in three lockfiles; that duplication is the price of isolation and is accepted).

### Contracts v1.0.0 (field-level summary; the schema files are the truth)
Every file: `contract` (name), `version` ("1.0.0"), `run_id`. Paths are relative to the run folder. Ids: pages `p01`, blocks `p01-b003`, images `p01-i02`, facts `f001`, directions `d1` to `d3`.

| Contract | Producer | Key fields |
|---|---|---|
| run.v1 (`00-run.json`) | orchestrator (A) | `source_url`, `site_slug`, `tier` (A, B or C), `consent {owner_ok, note}`, `created_at`, `limits {max_pages, lane_budget_usd {a, b, c}}` |
| inventory.v1 (`10-inventory.json`) | scout (A) | `crawled_at`, `robots_respected`; `pages[] {page_id, url, title, status_code, depth, screenshots {desktop, mobile}, blocks[] {block_id, kind (heading, paragraph, list, table, quote, legal, contact, nav, footer, cta), level, order, text}, images[] {image_id, src_url, local_path, alt, width, height, origin (site, third_party, unknown)}, links[] {href, text, internal}, forms[] {form_id, action, method, fields[] {name, type, label, required}, needs_backend}}`; `facts[] {fact_id, kind (phone, email, address, date, time, person, legal_notice, price), value, block_id}`; `brand {logo_path, colors[] {hex, role}, fonts[] {family, usage}}`; `failures[] {url, reason}`; `untrusted_text: true` |
| storyboard.v1 (`20-storyboard.json`) | story (B) | `organisation {name, what_it_does, audiences[], one_message}`, `tier`; `pages[] {slug, title, purpose, source_page_ids[], sections[] {section_id, intent (hero, story, proof, programs, people, news, events, contact, cta, legal, faq, gallery), body_block_ids[], image_ids[], copy {headline, subhead}, copy_status (verbatim, edited, new), edited_from_block_id}}`; `nav[] {label, slug}`; `dropped[] {ref, reason}` |
| directions.v1 (`30-directions.json`) | art (B) | exactly 3 `directions[] {direction_id, name, concept, tokens {color {bg, surface, text, muted, accent, on_accent}, type {display_family, body_family, source, scale_px[], line_height}, radius_px, spacing_base_px, motion {level (none, subtle, expressive), reduced_motion_ok}}, layout {grid, hero_pattern, section_patterns {intent: pattern}}, references[] {url, why}, imagery {strategy (site_photos, generated, illustration, type_only), generated[] {path, prompt, model}}, previews {desktop, mobile}, contrast_checks[] {fg, bg, ratio}}`; `banned_patterns_checked[]` |
| verdict.v1 (`40-verdict.json`) | council (B) | `judges[] {model_id, family}`, `rubric_version`; `pairs[] {a, b, order_shown, judge, winner, rationale}`; `ranking[] {direction_id, wins, score}`; `top_direction_id`, `agreement`, `needs_human`; `calibration {set_version, accuracy, passed, measured_at}`; `compare_path`, `cost_usd` |
| selection.v1 (`45-selection.json`) | orchestrator (A) | `direction_id`, `chosen_by` (council, human), `reason`, `chosen_at` |
| handoff.v1 (`50-handoff.json`) | build (C) | `status` (pass, fail, budget); `site {repo_path, preview_url, preview_local, pages[] {slug, path, screenshots {desktop, mobile}}}`; `qa {axe {serious, critical, report_path}, lighthouse[] {slug, form_factor, accessibility, performance, best_practices}, links {checked, broken[]}, fact_diff {checked, changed[], missing[]}, gates_passed}`; `fidelity {pages_carried, pages_total, dropped[] {ref, reason}, flagged[] {ref, reason}}`; `report_path`, `cost_usd` |

### CLI shape (identical for every lane)
`node lanes/<lane>/cli.mjs <stage> --run <run dir> --in <contract file> [--in ...] --out <contract file> [--max-usd <n>]`
Exit codes: 0 ok; 1 crash; 2 input failed its schema; 3 quality gate failed (output written, `status: "fail"`); 4 budget cap hit (output written, `status: "budget"`). A stage writes only its `--out` file and its own run subfolder. Exact commands are in plan/plan.md "Interfaces".

### Contract change-request rule
1. Contracts are written once by Abhinav and Claude on Day 0 and frozen at tag `contracts-v1.0.0` (Sun Nov 1 21:00 PST).
2. Anyone who needs a change opens a GitHub issue with the label `contract-cr` and the template: contract, field, why, the fixture line that shows it, and whether it is additive. No one edits `contracts/` but Abhinav.
3. Abhinav approves or rejects within 12 hours and records the ruling in plan/rulings.md.
4. Additive and optional fields only: minor bump (v1.1.0), new schema file next to v1, fixtures updated, tag `contracts-v1.1.0`. Producers may start emitting it; consumers keep working because they validate against the version the file declares and ignore fields they do not use.
5. Breaking changes: major bump, allowed only before Wed Nov 4 09:00 PST and only if a lane is otherwise blocked; after that, no breaking change this week.

### Daily sync rule
- By 21:00 PST each day, each person appends one dated line to their own `lanes/<lane>/STATUS.md` (done task ids with SHAs, what is next, any blocker). STATUS.md lives inside your own folder, so no file is shared.
- Abhinav's Claude reads the three STATUS files and posts the summary to plan/board.md (`- [HH:MM] lane-x Txx: ... | @lane-y ask`). Asks between lanes go on the board or a GitHub issue, never as edits, comments in code, or pull requests into another lane.
- No one reviews, runs, pairs on or debugs another lane's code. If the orchestrator finds a lane failing, Abhinav posts the failing command and input file path; the owner fixes it in their own lane.
- Merging: each person merges their own PRs after CI passes (lane guard plus their own tests). CODEOWNERS makes them the required reviewer of their own folder; nobody approves another lane's PR.

## Lane A: Abhinav (lead): contracts, Scout, orchestrator, baseline, blind test
Owns: root files, `.github/`, `plan/`, `contracts/`, `orchestrator/`, `lanes/a-scout/`. Branch prefix `lane-a/`.
Writes contracts: run.v1, inventory.v1, selection.v1 (and authors all fixtures and samples). Reads: verdict.v1, handoff.v1.
Secrets: `lanes/a-scout/.env` with `A_OPENROUTER_API_KEY` (baseline only). Budget line: 10 USD for the week (proposed).
Why Abhinav owns integration: he owns the contracts, so every integration failure is either a contract question he rules on or a lane bug he routes; he works with Claude all week; he runs the Wed checkpoint with Vidyut; and one owner means no one else ever needs to run three lanes' code.

| Day | Tasks | Done when |
|---|---|---|
| Sun Nov 1 | T01 repo skeleton and lane guard; T02 and T03 seven schemas; T04 sample fixtures, cross validator, tag contracts-v1.0.0 | `contracts` tests pass, tag on origin, board line "contracts frozen" by 21:00 |
| Mon Nov 2 | T07 orchestrator stub mode; T08 Scout crawl and blocks; T09 screenshots, images, links, forms | stub run of the whole sample chain exits 0; Scout tests pass on the local fixture site |
| Tue Nov 3 | T16 brand, facts, injection safety; T17 real mode and operator pick | Scout produces a full inventory.v1; orchestrator handles exit codes and the pick |
| Wed Nov 4 | T24 readiness check by 09:00; T25 first real-site run, publish samples; T26 baseline | one real run reaches 50-handoff.json; checkpoint with Vidyut; samples published for B and C |
| Thu Nov 5 | T31 three-site runs, red-team routing; T32 blind test | three handoffs; blind test numbers recorded |
| Fri Nov 6 | T35 root README and clean-machine check | a teammate runs stub mode from the README |
| Sat Nov 7 | T38 demo video, summary, final judged review | every done-list line checked or a known gap |

Never touches: `lanes/b-design/`, `lanes/c-build/` (not even to read their source; only their outputs in `runs/`).
Master agents: master-planner (contract review before freeze), master-builder plus master-reviewer for each task, master-finder (consent and terms questions), master-auditor (red team on Thu, blind test design, final judge on Sat), master-writer (README, summary), master-creator (demo video), master-guardian (security pass on the Scout).
Hand-off: publishes `contracts/` (Day 0) and `contracts/samples/` (Wed onward); receives verdict and handoff files only through runs.

## Lane B: Nirmal: Storyteller, Art director, Council
Owns: `lanes/b-design/` only. Branch prefix `lane-b/`.
Reads contracts: run.v1, inventory.v1, selection.v1 (for the preference log). Writes: storyboard.v1, directions.v1, verdict.v1.
Secrets: `lanes/b-design/.env` with `B_OPENROUTER_API_KEY` (text models, Gemini image generation through OpenRouter, judge models). Budget line: 40 USD for the week (proposed); calibration is the big spend, so it samples 100 pairs, not all 625.
Builds against: `contracts/fixtures/sample/00-run.json` and `10-inventory.json` (Mon to Tue), then `contracts/samples/*` (Wed onward).

| Day | Tasks | Done when |
|---|---|---|
| Sun Nov 1 | T05 calibration manifest (25 award, 25 legacy, Awwwards terms read) | manifest test passes; TERMS.md written |
| Mon Nov 2 | T10 CLI skeleton and validation; T11 Storyteller | `story` writes a valid storyboard for the sample site with every block id real |
| Tue Nov 3 | T14 three direction briefs; T18 previews and Gemini imagery; T19 council pairwise runner; T20 compare page | `art` and `council` exit 0 on the fixture; post "Lane B integration ready" by 21:00 |
| Wed Nov 4 | T27 calibration run and 90 percent gate; T28 preference log | `report.json` with measured accuracy (pass or a documented fail) |
| Thu Nov 5 | T33 council fixes from calibration and the real run | regression case pinned, accuracy before and after recorded |
| Fri Nov 6 | T36 budgets, retries, cost log | 402/403 exit 4, 429 retry, cost per stage |
| Sat Nov 7 | freeze at 12:00 PST; bug fixes only on a board request | STATUS.md final line |

Never touches: anything outside `lanes/b-design/`, including `contracts/` (read only), `orchestrator/` and the other lanes. Never commits calibration screenshots.
Master agents: master-designer (direction prompts, anti-slop rules, banned patterns), master-auditor (calibration design and judge evaluation: this is an LLM-judge problem), master-builder plus master-reviewer for each task, master-finder (reference sites and Awwwards terms). If Nirmal works in his own Claude Code session, `lanes/b-design/CLAUDE.md` tells it to stay inside the folder.
Hand-off: his CLI's output files are the hand-off; he posts "integration ready" on the board when T19 passes on main.

## Lane C: Aditya: Builder, Red team QA, Handoff
Owns: `lanes/c-build/` only. Branch prefix `lane-c/`.
Reads contracts: run.v1, inventory.v1, storyboard.v1, directions.v1, selection.v1. Writes: handoff.v1.
Secrets: `lanes/c-build/.env` with `C_OPENROUTER_API_KEY` and, only after a host is approved, `C_PREVIEW_TOKEN`. Budget line: 25 USD for the week (proposed).
Builds against: the full sample fixture (Sun to Tue), then `contracts/samples/*` (Wed onward).

| Day | Tasks | Done when |
|---|---|---|
| Sun Nov 1 | T06 Astro base template with token slots | template builds with sample tokens, no banned libraries in dist |
| Mon Nov 2 | T12 CLI skeleton and validation; T13 tokens and pages from storyboard | one page per storyboard slug, nav order right, no dashes |
| Tue Nov 3 | T15 verbatim content with `data-src`; T21 axe and Lighthouse gates; T22 link check and fact diff; T23 report, local repo, handoff.json | `build` exits 0 on the sample site with a valid handoff; post "Lane C integration ready" by 21:00 |
| Wed Nov 4 | T29 quality pass on real samples; T30 preview publish (approval gated) | every sample builds and passes all gates |
| Thu Nov 5 | T34 fix top red-team defects | one test per defect, SHA posted on the board |
| Fri Nov 6 | T37 owner report polish | a school office can read the report's first five lines |
| Sat Nov 7 | freeze at 12:00 PST; bug fixes only on a board request | STATUS.md final line |

Never touches: anything outside `lanes/c-build/`. Does not deploy or create GitHub repos for output sites without approval for that exact action.
Master agents: master-designer (section components and craft floor), master-builder plus master-reviewer for each task, master-guardian (preview hosting choice and security pass, read-only until approved), master-auditor (red-team findings arrive on the board). `lanes/c-build/CLAUDE.md` keeps any Claude session inside the folder.
Hand-off: `50-handoff.json` plus the site repo and report under the run's `c-build/` folder.

## How Claude helps each lane without crossing lanes
- Claude (Abhinav's session) writes contracts, fixtures and the orchestrator, and reads only contract files from B and C.
- Any Claude session a teammate runs is started from inside their lane folder, with that lane's CLAUDE.md, and has the same off-limits list. No agent is ever briefed with two lanes' folders.
