# Redesign Agent

Give it the URL of a legacy website. A chain of focused agents researches what the organization does, writes the story its site should tell, designs three directions, picks one with a judging council, builds it, tries to break it, and hands over the new site's repository.

- **Plan (shareable):** https://claude.ai/artifact/GLWHBZZB1mhwbnLqX6vKTk
- **Week:** Sun Nov 1 to Sat Nov 7 2026. First real-site run Wed Nov 4. Demo Sat Nov 7.
- **Quality bar:** [trionn.com](https://trionn.com) (Awwwards Site of the Day, Jul 27 2026), within what each customer can host and maintain.
- **Status:** planning done, nothing built yet. Contracts freeze Sun Nov 1, 21:00 PST.

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
| C | Teammate 3 | `lanes/c-build/` | `lane-c/` | handoff |

Full day-by-day tasks per person: [plan/lanes.md](plan/lanes.md). All 38 tasks with files, failing tests and done criteria: [plan/plan.md](plan/plan.md).

### Rules

1. Every lane has the same command shape:
   `node lanes/<lane>/cli.mjs <stage> --run <run dir> --in <contract file> --out <contract file> [--max-usd <n>]`
   Exit codes: 0 ok, 1 crash, 2 input failed its schema, 3 quality gate failed, 4 budget hit.
2. Contracts live in `contracts/` and are edited only by Abhinav. They freeze at tag `contracts-v1.0.0`. To request a change, open a GitHub issue labelled `contract-cr`. Rulings within 12 hours. No breaking changes after Wed Nov 4, 09:00 PST.
3. Until Wednesday every lane builds against the Gallant fixtures in `contracts/fixtures/gallant/`. From Wednesday, real run outputs appear in `contracts/samples/`.
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
contracts/     schemas/ fixtures/gallant/ fixtures/invalid/ samples/ validate.mjs
orchestrator/  chains the three lanes (Abhinav only)
lanes/a-scout/   Abhinav
lanes/b-design/  Nirmal
lanes/c-build/   Teammate 3
runs/          gitignored run outputs
```

There is no root `package.json` and no workspaces. Each lane installs and pins its own dependencies.

## Stack

| Use | Avoid |
|---|---|
| Playwright and sitemap crawling | crawl4ai (credit clause for commercial web apps) |
| dembrandt, pinned | GSAP (free license bars tools that compete with Webflow) |
| Astro static, Tailwind, Radix primitives | Magic UI (generic AI look) |
| Motion or CSS scroll animation | Lenis and WebGL on school sites |
| axe-core, Lighthouse | Meta TRIBE v2 (non-commercial, predicts brain scans, takes no images) |
| OpenRouter for every model | New skill or MCP installs this week |

Installs are pending approval: nothing has been installed yet.

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

- [ ] Teammate 3's name and everyone's GitHub username (for CODEOWNERS)
- [ ] First test tier: public schools, or private schools and small organizations (recommended)
- [ ] OpenRouter budget per lane (proposed: A 10, B 40, C 25 USD)
- [ ] Five reviewers for the blind test on Thu Nov 5
- [ ] Preview host (needs Vidyut's OK before any account)
- [ ] Nirmal: confirm the Gallant content is OK as fixture data
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
