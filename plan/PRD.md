# Redesign Agent PRD (week of Sun Nov 1 to Sat Nov 7 2026)

Owner: Abhinav (lead). Idea owner: Vidyut. Team: Abhinav, Nirmal, Teammate 3.
Source of truth for decisions: plan/decisions.md. Lane split: plan/lanes.md. Task plan: plan/plan.md.
Times are PST.

## 1. Problem
Small organisations and US schools run sites that are dated, hard to use, or partly broken (for example a four page high school site where three pages do not load). Prompt builders such as v0 start from a blank page and a wish, and plain one-shot AI redesigns look generic. Nobody starts from the real site, keeps every fact, and rebuilds it around what the organisation actually does.

## 2. Users
- Primary (this week): the operator, Abhinav or a teammate, who runs one command on a URL and reviews the result.
- Buyer (after this week): a school communications office or a small organisation owner, usually non-technical. They read the plain-language report and click the preview link; they do not run the repo.
- Tier: the run carries a tier (A public school: calm, accessible, WCAG 2.1 AA; B private school or small organisation; C brand or studio, richer motion). Which tier is the first test is still OPEN in the plan; recommended B. The pipeline works for any tier because tier is a field in the run contract.

## 3. The one flow that must work
`node orchestrator/cli.mjs run --url <site> --tier B` does, in order:
1. Scout (Lane A) crawls the site (sitemap plus link fallback, robots respected), screenshots every page, extracts text blocks with source ids, images, links, forms, facts and brand colours. Writes `10-inventory.json`.
2. Storyteller (Lane B) writes who it is for, the one message and a page by page storyboard that references inventory block ids. Writes `20-storyboard.json`.
3. Art director (Lane B) writes three named directions (tokens, type, layout, references, imagery) and renders a preview of each. Writes `30-directions.json`.
4. Council (Lane B) compares the three in pairs with three vision models from different families. Writes `40-verdict.json`.
5. The operator picks a direction (default: the council's top pick). Orchestrator writes `45-selection.json`.
6. Builder, Red team and Handoff (Lane C) build the Astro static site, run axe-core, Lighthouse, a link check and a fact diff, and write a fidelity report, a local git repo and a preview. Writes `50-handoff.json`.
7. Orchestrator prints the preview URL or path, the repo path, the gate results and the report path.

## 4. Success metric (the done list from redesign-agent-plan.html)
1. One command takes a URL and produces a site, a preview link, a repository and a fidelity report.
2. Run on three sites (Prism, Gallant, one real legacy school site with owner consent). In a blind comparison, at least 4 of 5 reviewers prefer the redesign to the original, and at least 3 of 5 prefer it to a one-shot redesign by plain Claude of the same site.
3. Every page, contact detail and link on the old site is carried over or listed as dropped, with a reason.
4. Zero serious or critical axe-core violations, and Lighthouse accessibility at least 95 on mobile (proposed thresholds).
5. The council ranks 25 award-winning sites above 25 legacy school sites in at least 90 percent of pairs, or it is not trusted as a judge.
6. A short demo video and a written summary that name what still needs manual work.

## 5. Out of scope this week
- A public sign-up site, accounts, billing, hosted editing for the customer (flagged as required before anyone is charged).
- Rebuilding forms, logins, search or anything that needs a backend (they are flagged in the report, never dropped silently).
- Training or fine-tuning on preference signals (we only log them).
- Meta TRIBE v2 in any form; GSAP; crawl4ai; Magic UI; Lenis and WebGL on tier A; new skill installs; the shadcn default theme.
- Pushing output sites to GitHub or any host without an explicit approval for that exact action.

## 6. Constraints
- Three lanes, zero shared files or folders, hand-offs only through frozen versioned JSON contracts in `contracts/` (LOCKED, decisions.md line 15).
- Stack verdicts from devils-advocate.md: Playwright plus sitemap, dembrandt pinned (logo and colours only), Astro static, Tailwind, Radix primitives, Motion or CSS, axe-core plus Lighthouse blocking, OpenRouter for all models, VLM pairwise council plus calibration set.
- Models routed through OpenRouter; each lane keeps the model for each of its steps in its own `lanes/<x>/models.json` (the decisions.md preference for one config file yields to the LOCKED lane rule; the orchestrator prints all three).
- Each lane has its own OpenRouter key with its own credit limit (OpenRouter supports per-key USD limits with daily, weekly or monthly reset; REPORTED from openrouter.ai docs search, not tested on a live key).
- Scraped text is untrusted data: the Scout has no shell or write tools exposed to any model, and no model output from scraped text is executed.
- Demo only on sites whose owner agreed, or on Prism and Gallant. No student photos to model providers.
- No em dashes or en dashes in copy, code, comments or commits.

## 7. Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Contracts wrong on Day 0, lanes build to a bad shape | Integration fails Wed | Realistic Gallant fixture built from a real capture; cross-reference validator; change-request rule with minor bumps only after freeze |
| A lane CLI is not ready Wed | First real run slips | Orchestrator has a stub mode that substitutes fixtures for any missing lane; Tue 21:00 readiness gate; the run still shows the other stages |
| Judge cannot tell great from generic | Council meaningless | Calibration gate at 90 percent before the council's ranking is used; operator pick is the fallback |
| Builder output looks generic | Fails the blind test | Story-first storyboard, banned-pattern list, three-direction council, Lane A builds the plain Claude baseline independently so Lane C cannot soften its competition |
| Wrong facts or lost content | Real harm on a school site | Facts extracted by Scout with block ids; Lane C fact diff blocks on any change; fidelity report lists drops |
| Duplicate dependencies per lane (Playwright installed three times) | Disk and install time | Accepted price of isolation; each lane pins its own versions |
| Handoff unusable by a school office | No revenue | Preview link plus plain-language report now; hosted editing listed as a known gap |
| Prompt injection from scraped pages | Agents steered | Text passed as quoted data, no tool access in Scout, injection fixture test in Lane A |
