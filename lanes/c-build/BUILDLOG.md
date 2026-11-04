# Lane C build log (owner: Aditya)

Every Lane C task and every change made in `lanes/c-build/`. Task specs live in `plan/plan.md`; this file records what was actually built. Update it in the same commit as the change it describes.

## Build list

| Task | Builds | Depends on | Status | Branch | PR | Commits |
|---|---|---|---|---|---|---|
| T06 | Astro base template with token slots | none | done, pushed, PR to open | lane-c/T06-template | | fea9afc |
| T12 | CLI skeleton and input validation (exit codes 2 and 4) | T06 | done, hold merge until T23 | lane-c/T12-cli | | see change log |
| T13 | Pages from the storyboard, direction tokens, nav order | T12 | not started | lane-c/T13-pages | | |
| T15 | Verbatim content with `data-src`, images, form fallback | T13 | not started | lane-c/T15-content | | |
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
- `build.format: 'file'` so pages come out as `dist/about.html`, matching the paths in the sample handoff.
- Lane C code does not run anything in `contracts/` (lane `CLAUDE.md`); schemas and fixtures are read as JSON only. `lib/contracts.mjs` is our own Ajv 2020 check (strict, all errors) against the version each file declares.
- **Merge order (T12):** once `lanes/c-build/cli.mjs` is on main, the orchestrator runs it instead of filling the build stage from the sample. Until T23 the CLI checks inputs and budget but cannot build, so it exits 1 on valid input. Merging T12 to T22 early would turn a working stubbed build stage into a crash on Abhinav's real runs. So: T06 can merge any time; T12 to T22 stay as open PRs (reviewed, CI green) and merge together once T23 passes. A PR at that point can merge the stack in order with merge commits.
- CLI (T12): inputs are matched by their `contract` field, not their position. Unknown stage, missing `--run` or `--out`, a bad `--max-usd`, an extra contract or a duplicate are all exit 2. The budget is the smaller of `--max-usd` and `00-run.json` `limits.lane_budget_usd.c`; 0 or less exits 4 after writing a schema-valid handoff with `status: "budget"`, `gates_passed: false`, no measured QA, and a one-paragraph `c-build/report.md`. Its page paths point at files that do not exist, which is fine because the orchestrator stops on exit 4 before its cross check.
- `models.json` is `{ "build": null }`: the builder is deterministic (no model call, `cost_usd` 0). A model is added only if T29 shows the deterministic build is not good enough.

## Open items

- Ask Abhinav: add a `c-build` CI job (npm ci, `npx playwright install --with-deps chromium`, `node --test` in `lanes/c-build`); replace `@ADITYA_GH` with `@adithya916` in CODEOWNERS; run the orchestrator on Node 24, because Astro 7 needs Node 22 or later and the orchestrator runs our CLI with its own Node.
- T13 or T23: built pages link CSS at `/_astro/...` (root-absolute). Fine over a local server; opening `dist/index.html` straight from disk loses the styles. Decide before the handoff README tells an owner how to view it.

## Change log

- 2026-11-04 T06 (lane-c/T06-template): added `package.json`, `package-lock.json`, `.gitignore`, `template/` (astro.config.mjs, tokens.json from sample direction d2, Base layout writing tokens as CSS properties, global.css mapping them into Tailwind with a reduced-motion guard, Section component, index page), `lib/astro-build.mjs`, `test/template.test.mjs`, this file. Test written first and failed (no build helper), then passed. `node --test`: 1/1 pass. No em or en dashes in the lane. Commit fea9afc; lane guard ok (13 files).
- 2026-11-04 T06: pushed lane-c/T06-template (fea9afc, b79fa51) to origin at Aditya's request; PR into main to be opened.
- 2026-11-04 T12 (lane-c/T12-cli, cut from lane-c/T06-template): added `cli.mjs`, `lib/contracts.mjs`, `models.json`, `test/cli.test.mjs`; installed ajv 8.20.0. `.env.example`, `CLAUDE.md` and `STATUS.md` already existed. Tests written first and failed (no `lib/contracts.mjs`), then passed. Covers: each of the five invalid fixtures exits 2 naming the file, non-JSON input exits 2, missing selection exits 2, unknown stage or missing `--out` exits 2, `--max-usd 0` exits 4 with a valid budget handoff and report, a zero budget in `00-run.json` exits 4, our validator rejects `status: "pass"` with failed gates. `node --test`: 12/12 pass. No em or en dashes.
