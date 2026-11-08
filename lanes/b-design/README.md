# Lane B (b-design): Storyteller, Art director, Council

Owner: Nirmal. Writes `20-storyboard.json`, `30-directions.json`, `40-verdict.json` (contracts v1.0.0).

## Setup
```
cd lanes/b-design
npm ci
npx playwright install chromium
node --test
```
Live model calls need `B_OPENROUTER_API_KEY` in `lanes/b-design/.env` (see `.env.example`). Without `--live`, nothing touches the network except Google Fonts in the preview boards (set `B_NO_WEB_FONTS=1` to skip them).

## Stages (exactly as the orchestrator calls them)
```
node lanes/b-design/cli.mjs story   --run R --in R/00-run.json --in R/10-inventory.json --out R/20-storyboard.json
node lanes/b-design/cli.mjs art     --run R --in R/00-run.json --in R/10-inventory.json --in R/20-storyboard.json --out R/30-directions.json
node lanes/b-design/cli.mjs council --run R --in R/30-directions.json --out R/40-verdict.json
node lanes/b-design/cli.mjs learn   --in R/45-selection.json [--in ...] [--out data/preferences.jsonl]
```
Flags: `--live` (use models from `models.json`), `--max-usd <n>` (default: `limits.lane_budget_usd.b` from the run file), `--no-images` (accepted; no image generation exists yet).
Exit codes: 0 ok, 1 crash or usage, 2 input fails its schema or is missing, 3 quality gate failed (output still written), 4 budget (no output: Lane B contracts have no `status` field).

## What each stage does
- **story** (`story/story.mjs`): a rule draft from the inventory. One storyboard page per crawled page, sections split at headings, legal and contact blocks get their own sections, intent from heading words. Every fact's block is rendered or listed in `dropped` by block id, so Lane C's fact diff never fails on a block we left out (issue 14). 404s and backend forms go to `dropped` with a reason. `--live` sends the inventory (blocks that name a person are withheld) and the draft to the model, and keeps its reply only if it passes the schema and every gate; otherwise it uses the draft and says why.
- **art** (`art/directions.mjs`, `art/board.mjs`): three fixed personalities (d1 civic, d2 the site's own colours, d3 editorial). Every colour pair is fitted by code to at least 4.5:1 and recorded in `contrast_checks`. Tier A never gets expressive motion. Banned patterns are in `art/banned.md`. `--live` lets a model rename, re-pitch and pick accents; code re-checks everything. Boards are rendered to `b-design/boards/` and screenshotted to `b-design/previews/`. No old-site image is drawn on a board (photos and logo are placeholders) because previews go to model judges.
- **council** (`council/council.mjs`, `council/compare.mjs`): `--live` asks three judges from three families (`models.json`) to compare every pair in both orders (18 calls, desktop and mobile screenshots each). Ranking by wins, agreement as the share of votes matching each pair's majority, position flips logged. `needs_human` is true when agreement is below 0.67, the top spot ties, calibration has not passed, or no vision judge ran. Without `--live` a contrast-only rule judge runs and always asks a human. Writes `b-design/compare.html`.
- **learn** (`council/learn.mjs`): appends one row per run to `data/preferences.jsonl` (council top versus final pick), once per run_id.

## Handoff from Abhinav's session (Sat Nov 7)
Built on branch `lane-b/core` to unblock integration: T10, T11, T14, T18 (previews only), T19, T20, T28, T36. All with tests (`node --test`, 54 passing on Node 20.13), reviewed twice by master-reviewer, and run end to end on a real Scout crawl of the sample site (every stage exits 0, outputs validate).
Known limits:
- `scrub()` withholds names only where Scout reports a `person` fact, and Scout reports none this week. So `--live` can still send names that sit in body text to providers. Do not run `--live` on a real school site until that is ruled on.
- `learn` records a run once; a verdict added after its first row is not picked up.
- The model ids in `models.json` were read from the OpenRouter models list on Nov 7.
Not done, with a GitHub issue each: T05 calibration manifest and TERMS.md, T27 calibration run (needs the manifest and the key), T33 council fixes (needs real runs), T18 Gemini imagery, one live run of each stage saved to `test/recorded/`, and checking the model ids in `models.json` still exist before a live run.
Read before changing: the gates in `story/story.mjs` `gate()` and `art/directions.mjs` `gate()` are what keep the contracts honest; extend them, do not loosen them.
