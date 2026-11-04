# Lane C build log (owner: Aditya)

Every Lane C task and every change made in `lanes/c-build/`. Task specs live in `plan/plan.md`; this file records what was actually built. Update it in the same commit as the change it describes.

## Build list

| Task | Builds | Depends on | Status | Branch | PR | Commits |
|---|---|---|---|---|---|---|
| T06 | Astro base template with token slots | none | done, pushed, PR to open | lane-c/T06-template | | fea9afc |
| T12 | CLI skeleton and input validation (exit codes 2 and 4) | T06 | done, hold merge until T23 | lane-c/T12-cli | | b0ef668 |
| T13 | Pages from the storyboard, direction tokens, nav order | T12 | done, hold merge until T23 | lane-c/T13-pages | | da00af7 |
| T15 | Verbatim content with `data-src`, images, form fallback | T13 | done, hold merge until T23 | lane-c/T15-content | | see change log |
| T21 | QA gates: axe-core and Lighthouse | T15 | not started | lane-c/T21-a11y | | |
| T22 | QA gates: link check and fact diff | T21 | not started | lane-c/T22-links-facts | | |
| T23 | Handoff: screenshots, report, local repo, 50-handoff.json | T22 | not started | lane-c/T23-handoff | | |
| T29 | Builder quality pass on real samples (`contracts/samples/`) | T23 | not started | | | |
| T30 | Preview publish (approval gated: no deploy or account without an explicit OK) | T23 | not started | | | |
| T34 | Fix top red-team defects, one test each | T29 | not started | | | |
| T37 | Owner report polish and hardening | T34 | not started | | | |

## Pinned packages

| Package | Version | Added in | Note |
|---|---|---|---|
| astro | 7.4.1 | T06 | 7.4.5 was 2 days old; 7.4.1 is the newest release older than 2 weeks. Needs Node 22 or later |
| tailwindcss | 4.3.3 | T06 | same rule (4.3.4 too new) |
| @tailwindcss/vite | 4.3.3 | T06 | same rule |
| ajv | 8.20.0 | T12 | same version as `contracts/` |

## Decisions

- Builds run in `lanes/c-build/.work/<id>/` (gitignored), never under `runs/`, so Astro and Tailwind resolve from this lane's `node_modules`. `lib/astro-build.mjs` is the one way to build; later tasks copy the source and `dist/` into the run folder.
- Banned-library check (T06): `gsap` and `lenis` anywhere, and `three` only in module form (`three.js`, `three.module.js`, `from "three"`). A bare "three" check would fail on ordinary copy such as "three cards".
- `build.format: 'file'` so pages come out as `dist/about.html`, matching the paths in the sample handoff. `build.assetsPrefix: '.'` (T13) makes the CSS link `./_astro/...`, and nav links are `./<page>.html`; every page sits at the site root, so the site works served or opened from disk. A test fails on any root-absolute `href` or `src`.
- Pages are data, not generated code (T13): the builder writes `src/data/site.json` and one route, `src/pages/[...slug].astro`, renders every page from it. Scraped or model-written text therefore always goes through Astro's escaping, never into source code.
- Dash rule (T13, `builder/text.mjs`): a dash between numbers becomes a hyphen (`9-12`), any other em or en dash becomes `, `. Applied to every string in `site.json`. T15's verbatim check and T22's fact diff must apply the same function. Source files spell the characters as `\u2013` and `\u2014` escapes so the lane itself has none.
- Sections (T13): a hero section renders as a full-width accent band with the page's only `h1`; a page with no hero gets its title as the `h1`. Every other intent uses one generic `Section` (h2, subhead) carrying `data-intent` and `data-pattern`. The plan said one component per intent; the direction's `section_patterns` are free text ("three cards", "dated list"), so real per-pattern layouts wait for T29, when there is content to lay out. The grid width comes from `layout.grid` ("1200 px max").
- The run's site is a standalone Astro project (`c-build/site/package.json` pins the same versions as this lane; a test keeps them equal), so the owner can `npm ci && npm run build` it.
- Lane C code does not run anything in `contracts/` (lane `CLAUDE.md`); schemas and fixtures are read as JSON only. `lib/contracts.mjs` is our own Ajv 2020 check (strict, all errors) against the version each file declares.
- **Merge order (T12):** once `lanes/c-build/cli.mjs` is on main, the orchestrator runs it instead of filling the build stage from the sample. Until T23 the CLI checks inputs and budget but cannot build, so it exits 1 on valid input. Merging T12 to T22 early would turn a working stubbed build stage into a crash on Abhinav's real runs. So: T06 can merge any time; T12 to T22 stay as open PRs (reviewed, CI green) and merge together once T23 passes. A PR at that point can merge the stack in order with merge commits.
- CLI (T12): inputs are matched by their `contract` field, not their position. Unknown stage, missing `--run` or `--out`, a bad `--max-usd`, an extra contract or a duplicate are all exit 2. The budget is the smaller of `--max-usd` and `00-run.json` `limits.lane_budget_usd.c`; 0 or less exits 4 after writing a schema-valid handoff with `status: "budget"`, `gates_passed: false`, no measured QA, and a one-paragraph `c-build/report.md`. Its page paths point at files that do not exist, which is fine because the orchestrator stops on exit 4 before its cross check.
- `models.json` is `{ "build": null }`: the builder is deterministic (no model call, `cost_usd` 0). A model is added only if T29 shows the deterministic build is not good enough.
- Content (T15, `builder/content.mjs`): every body block is rendered word for word with `data-src="<block_id>"`. A list block becomes one `li` per line; a heading becomes `h3`; a quote becomes `blockquote`; anything else is a `p` with one line per text line. In an **edited** section, the block named in `edited_from_block_id` is not rendered, because the section headline is the storyteller's rewrite of it; every other block renders. A section or image id the inventory does not have is exit 2.
- Images (T15): copied from the run folder into the site's `public/images/<image_id>.<ext>` and rendered with the inventory alt text, width and height, plus `data-src`. An image with no `local_path` or no file on disk is skipped here; T23 must list it in the report as not carried over.
- Forms (T15): a form with `needs_backend` becomes a "Send us a message" note with tel and mailto links from the first phone and email facts, in the page's contact section (or its last section). No `<form>` is rendered. Forms that do not need a backend are not rendered yet; T23 must flag them.
- Build folders (T15): each build gets a fresh `mkdtemp` folder under `.work/`, because `node --test` runs test files in parallel and two builds of one run id collided.

## Open items

- Ask Abhinav: add a `c-build` CI job (npm ci, `npx playwright install --with-deps chromium`, `node --test` in `lanes/c-build`); replace `@ADITYA_GH` with `@adithya916` in CODEOWNERS; run the orchestrator on Node 24, because Astro 7 needs Node 22 or later and the orchestrator runs our CLI with its own Node.
- ~~T13 or T23: built pages link CSS at `/_astro/...`~~ Closed in T13 with `assetsPrefix: '.'`.
- T21: sections fade in over 600 ms (`.reveal`). Run axe and the screenshots with reduced motion emulated (or after animations end), or colour contrast is measured on half-faded text.
- T23: report images skipped for lack of a local file, and forms that need no backend (not rendered yet), as not carried over.
- T29: the sample news list starts with its own old heading line ("News and Announcements") under the new section headline. It is kept because blocks are verbatim; a quality pass could drop a first list line that repeats the headline, recorded as an edit.
- T23: the built CSS file is named `_..<hash>.css` (from the `[...slug]` route name). Harmless, but rename the route if an owner finds it confusing.

## Change log

- 2026-11-04 T06 (lane-c/T06-template): added `package.json`, `package-lock.json`, `.gitignore`, `template/` (astro.config.mjs, tokens.json from sample direction d2, Base layout writing tokens as CSS properties, global.css mapping them into Tailwind with a reduced-motion guard, Section component, index page), `lib/astro-build.mjs`, `test/template.test.mjs`, this file. Test written first and failed (no build helper), then passed. `node --test`: 1/1 pass. No em or en dashes in the lane. Commit fea9afc; lane guard ok (13 files).
- 2026-11-04 T06: pushed lane-c/T06-template (fea9afc, b79fa51) to origin at Aditya's request; PR into main to be opened.
- 2026-11-04 T12 (lane-c/T12-cli, cut from lane-c/T06-template): added `cli.mjs`, `lib/contracts.mjs`, `models.json`, `test/cli.test.mjs`; installed ajv 8.20.0. `.env.example`, `CLAUDE.md` and `STATUS.md` already existed. Tests written first and failed (no `lib/contracts.mjs`), then passed. Covers: each of the five invalid fixtures exits 2 naming the file, non-JSON input exits 2, missing selection exits 2, unknown stage or missing `--out` exits 2, `--max-usd 0` exits 4 with a valid budget handoff and report, a zero budget in `00-run.json` exits 4, our validator rejects `status: "pass"` with failed gates. `node --test`: 12/12 pass. No em or en dashes.
- 2026-11-04 T12: pushed lane-c/T12-cli (b0ef668, on top of T06) to origin at Aditya's request. Any PR for it stays a draft until T23.
- 2026-11-04 T13 (lane-c/T13-pages, cut from lane-c/T12-cli): added `builder/tokens.mjs` (selected direction, exit 2 if the selection names an unknown direction), `builder/pages.mjs` (site data from the storyboard, build in `.work/<run_id>`, copy source and `dist/` to `R/c-build/site/`, remove `.work`), `builder/text.mjs` (dash rule), `test/build.test.mjs`; template: `src/pages/index.astro` replaced by `src/pages/[...slug].astro`, new `src/data/site.json` (neutral default), `src/components/Hero.astro`, `package.json`; `Section.astro` takes intent and pattern; `Base.astro` takes the grid width; `global.css` adds `.wrap` and the current-page nav style; `astro.config.mjs` adds `assetsPrefix: '.'`; `lib/astro-build.mjs` takes `site`. `cli.mjs` now builds the site after the input and budget checks, then still exits 1 (no QA or handoff before T21 to T23). Tests written first and failed (no `builder/pages.mjs`). The test picks d3 (template default is d2), reverses the nav and adds dashes to the copy, so nothing passes by matching defaults. `node --test`: 21/21 pass. Ran the CLI on a copy of the sample: 3 pages built; served on 127.0.0.1 and checked in a browser (header band, nav with current page, h1, accent headings, fonts load). Found and fixed: the file tool had written literal dash characters into `builder/text.mjs` and the test; now escapes. Recorded T12 SHA b0ef668 above. Added `test/no-dashes.test.mjs`, which fails on any em or en dash in a Lane C file (the tools used to write files decode unicode escapes into real dashes; this caught it twice), so the suite is now 22/22.
- 2026-11-04 T13: pushed lane-c/T13-pages (da00af7, on top of T12) to origin at Aditya's request. Any PR for it stays a draft until T23.
- 2026-11-04 T15 (lane-c/T15-content, cut from lane-c/T13-pages): added `builder/content.mjs` (inventory index, section blocks, section images, form fallbacks), `test/content.test.mjs`, template `src/components/Blocks.astro` and `FormFallback.astro`; `Section.astro` and `Hero.astro` render blocks and images; the route passes them; the default `site.json` has the new fields; `builder/pages.mjs` adds content to the site data, copies images in, and builds in a fresh `mkdtemp` folder; `lib/astro-build.mjs` takes `assets`. Tests written first: 5 of 6 failed, and the 6th (edited block not repeated) passed only because nothing rendered yet. The test adds an em dash and a `<script>` tag to scraped blocks. `node --test`: 28/28 pass, run in parallel. Built the sample through the CLI and checked home and contact in a browser: crest in the hero, news list, address lines, and the message fallback with working tel and mailto links.
