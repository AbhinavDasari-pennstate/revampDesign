# Redesign Agent

Give it the URL of a legacy website. A chain of focused agents researches what the organization does, writes the story its site should tell, designs three directions, picks one with a judging council, builds it, tries to break it, and hands over the new site's repository.

- **Plan (shareable):** https://claude.ai/artifact/GLWHBZZB1mhwbnLqX6vKTk
- **Repo:** https://github.com/AbhinavDasari-pennstate/revampDesign
- **Week:** Sun Nov 1 to Sat Nov 7 2026. First real-site run Wed Nov 4. Demo Sat Nov 7.
- **Quality bar:** [trionn.com](https://trionn.com) (Awwwards Site of the Day, Jul 27 2026), within what each customer can host and maintain.
- **Status:** built so far: contracts v1.0.0, the orchestrator (stub and real mode), Scout (crawl, images, links, forms, facts, brand), the plain Claude baseline, and the blind test kit. Lanes B and C are in progress; the orchestrator fills any stage whose lane CLI is missing from the sample fixture and logs it as STUB.

## Quick start

Prerequisites: Node 24 (the version in `.nvmrc`). There is no root `package.json`; each lane installs its own dependencies with `npm ci` inside its own folder. Scout also needs the Playwright Chromium browser (on Linux use `npx playwright install --with-deps chromium`, which also installs the system libraries and needs root).

The commands assume bash (macOS, Linux, WSL, Git Bash). PowerShell 7 accepts the same `&&` chains, but it has no subshells, so after a line in parentheses run `Set-Location` back to the repo root.

Everything below is run from the repo root, and every line leaves you there: a line in parentheses runs in a subshell, so its `cd` does not carry to the next line.

```
(cd contracts && npm ci && node --test)
(cd lanes/a-scout && npm ci && npx playwright install chromium)
```

Stub mode needs no keys and no network: it copies the sample run into `runs/` and checks every file against its contract.

```
node contracts/validate.mjs --cross contracts/fixtures/sample
node orchestrator/cli.mjs run --stub --fixture sample --out-dir runs
(cd orchestrator && node --test)
(cd lanes/a-scout && node --test)
```

Crawl one site with Scout. Copy the sample run file, then edit the copy: set `source_url` to a site you have the owner's consent to crawl, set `site_slug` to a short name for it, and set `consent.owner_ok` to `false` (or record real consent: `true` plus a note saying who agreed and when). The sample says `true` only because its site is fictional. Then crawl and check the result. Output goes under `runs/`, which git ignores.

```
mkdir -p runs/my-crawl && cp contracts/fixtures/sample/00-run.json runs/my-crawl/00-run.json
node lanes/a-scout/cli.mjs scout --run runs/my-crawl --in runs/my-crawl/00-run.json --out runs/my-crawl/10-inventory.json
node contracts/validate.mjs runs/my-crawl/10-inventory.json
```

The plain Claude baseline (a one-shot redesign to compare against) calls OpenRouter and spends money. It needs `A_OPENROUTER_API_KEY` exported in your shell (the command does not read `lanes/a-scout/.env`; `lanes/a-scout/.env.example` shows the name). Do not run it casually. With `--response` it reads a recorded reply from a file instead, which is how its tests run.

```
node lanes/a-scout/cli.mjs baseline --run runs/my-crawl --in runs/my-crawl/10-inventory.json
```

The blind test kit shuffles the original, the redesign and the baseline under neutral letters; the seed is mixed with the site slug, so the order usually differs per site. It needs a finished run in `runs/<run id>/` (replace `<run id>` with that folder's name): `00-run.json`, `10-inventory.json`, `50-handoff.json` (written by the build stage, Lane C), the baseline screenshots `a-scout/baseline/screens/index-desktop.png` and `index-mobile.png`, and every screenshot those files name. It writes `a-scout/blindtest/kit/` and `key.json` into that folder. Hand reviewers only the `kit/` folder, never `key.json`. Running it again with another seed is refused, so collected answers cannot be scored against changed letters.

```
node lanes/a-scout/cli.mjs blindtest --run runs/<run id> --seed 7
node lanes/a-scout/cli.mjs blindtest --score
```

Write each reviewer's ranking, best first, into `lanes/a-scout/blindtest/results.json` as `{"sites": [{"site": "<site_slug>", "key": "keys/<site_slug>.json", "rankings": {"<reviewer>": ["B", "A", "C"]}}]}`, five reviewers per site. When a site's review ends, copy its `key.json` to `lanes/a-scout/blindtest/keys/<site_slug>.json` and commit it (`runs/` is git ignored), so anyone can score. The scorer prints the 4 of 5 and 3 of 5 results per site.

## The pipeline

| Stage | Lane | What it does |
|---|---|---|
| Scout | A | Crawls every page. Records text blocks (tagged with their source page), images, links, forms, facts, and the old site's colors and type. |
| Storyteller | B | Works out what the organization does and for whom. Writes a page-by-page storyboard. |
| Art director | B | Writes exactly three design directions: tokens, type, layout, real reference sites, previews. |
| Council | B | Three vision models from different families compare the directions in pairs. A person breaks ties. |
| Builder | C | Builds the chosen direction as a static Astro site. |
| QA / red team | C | axe-core, Lighthouse, link check and a fact diff against the source. All blocking. |
| Handoff | C | Preview link, the repository, and a plain-language report of anything not carried over. |

## Who owns what

Rule: **nobody touches anyone else's work in any form.** Separate folders, branch prefixes, API keys and dependency lists. Lanes exchange only JSON files that match a frozen contract.

| Lane | Owner | Folders | Branches | Writes |
|---|---|---|---|---|
| A | Abhinav (lead) | repo root, `.github/`, `plan/`, `contracts/`, `orchestrator/`, `lanes/a-scout/` | `lane-a/` | run, inventory, selection |
| B | Nirmal | `lanes/b-design/` | `lane-b/` | storyboard, directions, verdict |
| C | Aditya | `lanes/c-build/` | `lane-c/` | handoff |

Full day-by-day tasks per person: [plan/lanes.md](plan/lanes.md). All 38 tasks with files, failing tests and done criteria: [plan/plan.md](plan/plan.md).

### Rules

1. Every lane has the same command shape:
   `node lanes/<lane>/cli.mjs <stage> --run <run dir> --in <contract file> --out <contract file> [--max-usd <n>]`
   Exit codes: 0 ok, 1 crash, 2 input failed its schema, 3 quality gate failed, 4 budget hit.
2. Contracts live in `contracts/` and are edited only by Abhinav. They freeze at tag `contracts-v1.0.0`. To request a change, open a GitHub issue labelled `contract-cr`. Rulings within 12 hours. No breaking changes after Wed Nov 4, 09:00 PST.
3. Until Wednesday every lane builds against the sample fixtures in `contracts/fixtures/sample/`. From Wednesday, real run outputs appear in `contracts/samples/`.
4. CI fails any pull request whose branch prefix touches a folder outside that lane. CODEOWNERS makes each person the only reviewer of their own folder.
5. Daily sync: one dated line in your own `lanes/<lane>/STATUS.md` by 21:00 PST. Questions go on `plan/board.md` or a GitHub issue, never as edits to someone else's files.
6. Each lane has its own `.env` (`A_`, `B_`, `C_OPENROUTER_API_KEY`). Never commit `.env`.
7. If you use Claude Code, start it from inside your own lane folder. That folder's `CLAUDE.md` keeps it there.

### Contracts (v1.0.0)

| File | Producer | Holds |
|---|---|---|
| `00-run.json` | orchestrator (A) | source URL, tier, owner consent, limits |
| `10-inventory.json` | scout (A) | pages, blocks, images, links, forms, facts, brand |
| `20-storyboard.json` | story (B) | organization, page order, sections, source block ids |
| `30-directions.json` | art (B) | three directions: tokens, layout, references, previews |
| `40-verdict.json` | council (B) | pairwise votes, ranking, calibration accuracy |
| `45-selection.json` | orchestrator (A) | chosen direction and who chose it |
| `50-handoff.json` | build (C) | site, preview, QA scores, fidelity report |

## Repo layout

```
README.md  .gitignore  .nvmrc
.github/CODEOWNERS  .github/workflows/ci.yml  .github/scripts/lane-guard.mjs
plan/          PRD, plan, lanes, decisions, research, devil's advocate, board
contracts/     schemas/ fixtures/sample/ fixtures/invalid/ samples/ validate.mjs
orchestrator/  chains the three lanes (Abhinav only)
lanes/a-scout/   Abhinav
lanes/b-design/  Nirmal
lanes/c-build/   Aditya
runs/          gitignored run outputs
```

There is no root `package.json` and no workspaces. Each lane installs and pins its own dependencies.

## Stack

| Use | Avoid |
|---|---|
| Playwright only (no sitemap crawling) | crawl4ai (credit clause for commercial web apps) |
| Brand colors and type read from the page with Playwright (dembrandt dropped) | GSAP (free license bars tools that compete with Webflow) |
| Astro static, Tailwind, Radix primitives | Magic UI (generic AI look) |
| Motion or CSS scroll animation | Lenis and WebGL on school sites |
| axe-core, Lighthouse | Meta TRIBE v2 (non-commercial, predicts brain scans, takes no images) |
| OpenRouter for every model | New skill or MCP installs this week |

Installed and pinned: ajv 8.20.0 in `contracts/` and Playwright 1.64.1 in `lanes/a-scout/`. `orchestrator/` has no dependencies. Nothing else is approved yet.

## What "done" means on Saturday

- One command turns a URL into a site, a preview link, a repository and a fidelity report.
- On three sites, at least 4 of 5 blind reviewers prefer the redesign to the original, and at least 3 of 5 prefer it to a plain one-shot Claude redesign.
- Every page, contact detail and link on the old site is carried over or listed as dropped with a reason.
- Zero serious axe-core violations. Lighthouse accessibility at least 95 on mobile.
- The council ranks 25 award-winning sites above 25 legacy school sites in at least 90 percent of pairs.
- A demo video and a summary that name what still needs manual work.

The numeric targets are proposals and can change.

## How we got here

1. **Oct 31, meeting with Vidyut.** Vidyut pitched the idea: a URL goes in, research and a storyline come out, three directions, a pick, a finished site and a repo. Target customers: legacy sites such as high schools in the US and India. The bar is trionn.com. A skeleton was asked for this weekend and a real-site test by Wed or Thu.
2. **First PRD review.** The idea is a real wedge (it starts from the existing site, so the content is known). Weak points: no chosen customer, an over-designed multi-model setup for a first version, an unverified aesthetic judge, and an undefined "self-learning" loop.
3. **Master playbook started** in product mode: decisions ledger, shared board and state files in `plan/`.
4. **Research (master-finder):** trionn.com verified. The closest competitor is Repaint (YC S23): you paste a URL and get a hosted redesign, at $25 to $200 a month. UIClip is the best open model for scoring screenshots. The Penn State company that raised about $2M was not found.
5. **Aesthetic model identified** by Abhinav as Meta TRIBE v2. A check of the primary sources showed it is CC BY-NC (non-commercial), trained on 720 people (not 800,000), takes video, audio or text, and predicts brain responses rather than preference. It is cut from the product, and a calibrated council of vision models replaces it.
6. **Devil's advocate (master-planner):**
   - The GSAP and crawl4ai licenses were swapped out.
   - No skill installs this week, because the candidates run unpinned code.
   - US public schools must meet WCAG 2.1 AA by Apr 2027 or Apr 2028, depending on size.
   - The handoff to a non-technical school office is the top business risk.
7. **One-week plan published** as a shareable artifact.
8. **Three-lane split (master-planner):**
   - 38 tasks and 7 contracts.
   - The Storyteller moved to Nirmal's lane, because the story and the directions iterate together.
   - Abhinav owns the contracts and the orchestrator, so integration has one owner.

## Open items

- [ ] Everyone's GitHub username (for CODEOWNERS)
- [ ] First test tier: public schools, or private schools and small organizations (recommended)
- [ ] OpenRouter budget per lane (proposed: A 10, B 40, C 25 USD)
- [ ] Five reviewers for the blind test on Thu Nov 5
- [ ] Preview host (needs Vidyut's OK before any account)
- [ ] Name of the Penn State company that raised about $2M

## Documents

| File | What it is |
|---|---|
| [plan/PRD.md](plan/PRD.md) | Product requirements |
| [plan/plan.md](plan/plan.md) | 38 tasks with tests and done criteria |
| [plan/lanes.md](plan/lanes.md) | Per-person ownership and schedule |
| [plan/decisions.md](plan/decisions.md) | Every locked, rejected and preferred decision |
| [plan/research.md](plan/research.md) | Repos, skills, the aesthetic model, references, competitors |
| [plan/devils-advocate.md](plan/devils-advocate.md) | Keep, swap or cut verdicts on the stack |
| [plan/board.md](plan/board.md) | Shared coordination board |
| [plan/redesign-agent-plan.html](plan/redesign-agent-plan.html) | Source of the shared plan page |
