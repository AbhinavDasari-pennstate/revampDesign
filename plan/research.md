# G1 research: website redesign agent pipeline

Checked 2026-10-31 20:27 to 20:35 EDT (17:27 to 17:35 PDT) by master-finder. Star counts, last push dates and licenses come from the GitHub REST API (`gh api repos/<owner>/<repo>`) in this run unless marked otherwise. Pipeline steps: S1 research/scrape, S2 storyboard, S3 design PRD (3 directions), S4 judges plus aesthetic simulator, S5 builder, S6 review/red team.

Maturity labels: **proven** (large org or long track record, widely used), **emerging** (active, fast growth, under about 18 months old or single maintainer), **experimental** (new, small, research code or unclear license).

## Top picks (10 lines)

1. The bar site is **trionn.com** (TRIONN, Rajkot, India). VERIFIED: trionn.com returns 200 with title "TRIONN | AI-Powered Creative Design & Development Studio in India"; trion.com redirects to marshmma.com (insurance) and crion.com to aon.com. Its current site won Awwwards **Site of the Day, Jul 27, 2026** (awwwards.com/sites/trionn-2); the HTML ships Next.js, GSAP, Lenis and WebGL.
2. S1 scrape: **crawl4ai** (86.7k stars, Apache-2.0) or plain Playwright plus sitemap, plus **dembrandt** (3.9k, MIT) for W3C design tokens from the old site. Paid scrapers are not needed for school sites.
3. S3/S5 component stock: **shadcn/ui** (127k, MIT), **Magic UI** (23k, MIT), **Motion** (34.7k, MIT), **Lenis** (17k, MIT), **GSAP** plus the official **gsap-skills** (17.6k, MIT). **React Bits** (50.9k) is MIT plus Commons Clause: OK to use in client sites, check before reselling.
4. Skills we lack, try first: **pbakaus/impeccable** (98k, Apache-2.0; has audit/critique/polish modes), **Leonxlnx/taste-skill** (107k, MIT; anti-slop art direction plus a browser look-and-fix loop), **vercel-labs/agent-skills web-design-guidelines** (33k repo). Read each SKILL.md and its scripts before install.
5. MCPs we lack: **microsoft/playwright-mcp** (38.9k, Apache-2.0) and **ChromeDevTools/chrome-devtools-mcp** (54.6k, Apache-2.0) for screenshots in S1, S4 and S6.
6. URL-to-code prior art to borrow from, not fork whole: **abi/screenshot-to-code** (80.9k, MIT) and **firecrawl/open-lovable** (28.8k, MIT, "clone and recreate any website as a modern React app").
7. Aesthetic simulator: **UNRESOLVED**. No source for "800,000 people" found. Closest Japanese brain-response match is NTT DATA's commercial **NeuroAI / D-Planner** (no public API found); closest open brain model is **Meta TRIBE v2** (720 subjects, CC BY-NC 4.0, video/audio/text input, not built for screenshots).
8. Best open screenshot scorer today: **UIClip** (CMU BigLab, UIST 2024, MIT weights on Hugging Face; scores a UI screenshot plus description as well or poorly designed). Pair it with a pairwise VLM judge council; treat LAION-style aesthetic predictors as photo scorers only.
9. The YC company is most likely **Repaint** (YC Summer 2023, "Build a website by chatting with AI"; its redesign tool takes your URL; $25 / $100 / $200 per month). The Penn State $2M company: NOT FOUND.
10. Licenses to avoid for a commercial product: TRIBE v2 (CC BY-NC), Q-Align repo (S-Lab non-commercial), Magic Portfolio (CC BY-NC), Awwwards-mcp (states personal, non-commercial use); flag AGPL on Firecrawl self-host, Superdesign and aesthetic-predictor-v2-5.

## 1. GitHub repos (above 50 stars)

All rows VERIFIED via GitHub API at 20:29 EDT unless noted. "Last push" is `pushed_at`, the closest API proxy for last commit.

### Design systems, components, motion (S3, S5)

| Repo | Stars | Last push | License | Step | Label | Call |
|---|---|---|---|---|---|---|
| shadcn-ui/ui | 127,061 | 2026-10-31 | MIT | S5 base components, S3 token vocabulary | proven | keep |
| magicuidesign/magicui | 23,002 | 2026-10-31 | MIT | S5 animated sections (marquee, bento, globe) | proven | keep |
| DavidHDev/react-bits | 50,860 | 2026-10-31 | MIT + Commons Clause (license file read) | S5 animated text and backgrounds | emerging | try; flag: Commons Clause forbids selling the software itself |
| motiondivision/motion | 34,731 | 2026-10-31 | MIT | S5 motion | proven | keep |
| darkroomengineering/lenis | 17,016 | 2026-10-29 | MIT | S5 smooth scroll (trionn uses it) | proven | keep |
| greensock/GSAP | 29,984 | 2026-04-13 | not set on GitHub (NOT CHECKED: license page not fetched this run) | S5 scroll storytelling, ScrollTrigger | proven | keep, after a license read |
| greensock/gsap-skills | 17,643 | 2026-07-29 | MIT | S5 agent skill for correct GSAP use | emerging (official org) | try |
| pmndrs/react-three-fiber | 33,401 | 2026-10-21 | MIT | S5 WebGL hero moments | proven | try, only where the story needs 3D |
| serafimcloud/21st | 5,541 | 2025-05-28 | MIT | S3 references (21st.dev marketplace) | emerging, stale repo | skip repo; we already have 21st MCP |
| 21st-dev/magic-mcp | 6,328 | 2026-09-09 | ISC | S5 | emerging | already have |
| Aceternity UI | no public repo found | | | | | NOT FOUND (searched: `gh search repos aceternity`, top results were unrelated) |
| style-dictionary/style-dictionary | 4,875 | 2026-10-28 | Apache-2.0 | S3/S5 token build to CSS/Tailwind | proven | keep |

### Templates (S5 starting points)

| Repo | Stars | Last push | License | Label | Call |
|---|---|---|---|---|---|
| arthelokyo/astrowind (was onwidget/astrowind) | 6,109 | 2026-09-12 | MIT | proven | try for content-heavy school sites (Astro is static, cheap to host) |
| cruip/open-react-template | 4,717 | 2025-12-12 | none on API | proven | skip (no license detected) |
| PageAI-Pro/page-ui | 1,697 | 2026-07-06 | MIT | emerging | try as section library |
| launch-ui/launch-ui | 871 | 2026-09-04 | MIT | emerging | try |
| once-ui-system/magic-portfolio | 1,420 | 2026-10-31 | CC BY-NC 4.0 (license file read) | emerging | skip (non-commercial) |

Templates are the slop risk: use them for structure only; S3 must art-direct over them.

### Website-to-code, URL-to-redesign, generators (S1, S5)

| Repo | Stars | Last push | License | Step | Label | Call |
|---|---|---|---|---|---|---|
| abi/screenshot-to-code | 80,945 | 2026-10-27 | MIT | S5 fidelity reference; README lists Gemini, GPT and Claude variants and recommends Gemini plus Replicate for asset extraction | proven | try (borrow prompts and eval loop) |
| firecrawl/open-lovable | 28,837 | 2026-10-09 | MIT | S1 to S5 end to end; needs FIRECRAWL plus one LLM key plus Vercel or E2B sandbox (README) | emerging | try as baseline to beat |
| onlook-dev/onlook | 27,064 | 2026-10-21 | Apache-2.0 | post-handover visual editing | emerging | try |
| wandb/openui | 22,720 | 2026-10-22 | Apache-2.0 | S3 quick UI sketches | emerging | skip (prompt-to-UI, not URL-driven) |
| dyad-sh/dyad | 22,142 | 2026-10-31 | Apache-2.0 except `src/pro/` (license file read) | S5 local builder | emerging | skip for pipeline |
| stackblitz-labs/bolt.diy | 20,018 | 2026-10-14 | MIT | S5 | emerging | skip |
| Nutlope/llamacoder | 7,149 | 2026-10-22 | MIT | S5 | emerging | skip |
| e2b-dev/fragments | 6,404 | 2026-10-31 | Apache-2.0 | S5 sandboxed preview | emerging | try if builder needs sandboxes |
| tldraw/make-real | 5,415 | 2026-02-18 | none | | archived | skip |
| superdesigndev/superdesign | 7,567 | 2026-06-29 | "Super Design License", mostly AGPLv3 (license file read) | S3 design agent | emerging | skip repo (AGPL); see its skill below |
| firecrawl/firecrawl | 197,407 | 2026-10-31 | AGPL-3.0 | S1 scrape; repo has `apps/api/src/lib/branding/` (brand extraction code, found by code search) | proven | use hosted API, do not self-host inside a closed product without legal read |

### Token and style extractors (S1)

| Repo | Stars | Last push | License | Label | Call |
|---|---|---|---|---|---|
| dembrandt/dembrandt | 3,897 | 2026-10-22 | MIT | emerging | keep: `npx dembrandt <url>` drives Chromium via playwright-core, outputs logo, colors, type, spacing, motion as W3C tokens; also has an MCP mode (README) |
| fivetaku/insane-design | 134 | 2026-10-13 | MIT | experimental | try: URL to design.md plus HTML report |
| freema/mcp-design-system-extractor | 72 | 2026-10-25 | MIT | experimental | skip (Storybook only, legacy sites have none) |

### Design critique, UI eval, aesthetic scoring (S4, S6)

| Repo or model | Stars / downloads | Last update | License | Label | Call |
|---|---|---|---|---|---|
| UIClip, HF `biglab/uiclip_jitteredwebsites-2-224-paraphrased_webpairs_humanpairs` | 1,314 downloads (HF API) | NOT CHECKED | MIT (model card) | emerging (paper: arXiv 2404.12500, UIST 2024) | keep: the only open model trained to rate UI screenshots |
| google-research-datasets/uicrit | 28 stars (below bar, listed as data) | 2024-11-19 | none on API (NOT CHECKED) | experimental | try as few-shot critique examples for judges, after license check |
| NoviScl/Design2Code | 604 | 2024-11-02 | MIT | experimental | try its fidelity metrics in S6 (visual match old content vs new) |
| Q-Future/Q-Align | 631 | 2026-06-24 | S-Lab License 1.0, non-commercial (license file read) | experimental | skip repo; note HF `q-future/one-align` card says MIT (conflict, primary repo license wins until resolved) |
| christophschuhmann/improved-aesthetic-predictor | 1,349 | 2024-07-01 | Apache-2.0 | proven for photos | skip for UI (trained on photo/art ratings) |
| discus0434/aesthetic-predictor-v2-5 | 442 | 2024-12-18 | AGPL-3.0 | experimental | skip |
| idealo/image-quality-assessment (NIMA) | 2,241 | 2024-07-12 | Apache-2.0 | archived | skip |
| facebookresearch/tribev2 | 3,334 | 2026-06-23 | CC BY-NC 4.0 | experimental | skip for product (see section 3) |

## 2. Skills and MCP servers we do not have

Trust check from GitHub API (created date, owner type, forks) at 20:32 EDT. Nothing installed. Before any install, read SKILL.md and every file under `scripts/`; I did NOT audit scripts.

| Item | Install source | Author / owner | Stars, created, last push | What it runs | Label | Call |
|---|---|---|---|---|---|---|
| impeccable | github.com/pbakaus/impeccable (`.claude/skills/impeccable`, also `.claude-plugin`) | pbakaus (user; Paul Bakaus, NOT CHECKED identity) | 98,271, created 2025-11-16, pushed 2026-10-31 | SKILL.md v4.8.0 plus `reference/` and `scripts/` dirs; modes include audit, critique, polish, animate, typeset, extract | emerging | try first: closest to an S6 design-review skill |
| taste-skill (design-taste-frontend v2) | github.com/Leonxlnx/taste-skill (`skills/taste-skill`, `install.sh`) | Leonxlnx (user) | 107,036, created 2026-02-19, pushed 2026-10-31 | SKILL.md plus `library`, `references`, `evals`, `scripts`; claims a study of 247 gallery sites and a real-browser inspector loop | emerging | try for S3; do not run install.sh blind |
| ui-ux-pro-max | github.com/nextlevelbuilder/ui-ux-pro-max-skill | nextlevelbuilder (org) | 143,420, created 2025-11-30 | `.claude/skills` holds banner-design, brand, design-system, design, slides, ui-styling, ui-ux-pro-max; plus `cli/`, `scripts/`, `src/` | emerging | try for style lookup; overlaps theme-factory |
| web-design-guidelines | github.com/vercel-labs/agent-skills (`skills/web-design-guidelines`) | vercel-labs (org) | 33,309, created 2025-12-08 | markdown skill (also react-best-practices, react-view-transitions, composition-patterns) | emerging (official org) | try in S6; repo has no license on API, flag |
| gsap-skills | github.com/greensock/gsap-skills | greensock (org) | 17,643, created 2026-03-04 | markdown skills | emerging (official) | try in S5 |
| superdesign-skill | github.com/superdesigndev/superdesign-skill | superdesigndev (org) | 927, created 2026-01-21 | skill, "stop shipping AI-slop UI" | emerging | try |
| interface-design | github.com/Dammyjay93/interface-design | Dammyjay93 (user) | 5,886, created 2026-01-05, pushed 2026-06-20 | design memory and enforcement for Claude Code | emerging | skip for now (product UI focus, overlaps) |
| frontend-design (Ilm-Alan) | github.com/Ilm-Alan/frontend-design | user | 154 | eight fixed aesthetic anchors | experimental | skip (overlaps ours) |
| juliobsz/skills | github.com/juliobsz/skills | user | 1,043, created 2026-10-12 | "builds award-caliber websites from one line" | experimental (19 days old) | watch only |
| playwright-mcp | github.com/microsoft/playwright-mcp | Microsoft (org) | 38,910, pushed 2026-10-31 | local browser automation MCP | proven | keep: S1 screenshots, S4 capture, S6 checks |
| chrome-devtools-mcp | github.com/ChromeDevTools/chrome-devtools-mcp | ChromeDevTools (org) | 54,562, pushed 2026-10-30 | Chrome with performance traces, Lighthouse-style data | proven | keep for S6 performance and a11y |
| firecrawl-mcp-server | github.com/firecrawl/firecrawl-mcp-server | firecrawl (org) | 7,736, pushed 2026-10-29 | hosted scrape API via MCP (needs key, paid beyond free tier) | emerging | try in S1 |
| dembrandt MCP | `npx -y dembrandt mcp` (README) | dembrandt (org) | see section 1 | local Chromium | emerging | try in S1 |
| magicuidesign/mcp | github.com/magicuidesign/mcp | magicuidesign (org) | 213, pushed 2026-04-07 | component search | emerging | try (cheap add to 21st MCP) |
| Awwwards-mcp | github.com/INSANE0777/Awwwards-mcp | user | 380, created 2026-09-18 | fetches and caches awwwards.com pages ("design DNA", jury scores); README says personal, non-commercial use | experimental | skip in the product; internal inspiration only after Vidyut OKs and Awwwards terms are read (NOT CHECKED) |
| GLips/Figma-Context-MCP | github.com/GLips/Figma-Context-MCP | user | 16,130 | Figma read | proven | skip (we have Figma MCP) |

Trust note: three skill repos gained about 100k stars each in under a year (ui-ux-pro-max, taste-skill, impeccable). Star counts are VERIFIED; whether they reflect real usage is NOT CHECKED. Judge them by output in a side-by-side, not by stars.

## 3. The aesthetic simulator

**State: UNRESOLVED.** I could not identify a model trained on "about 800,000 people".

Searched (WebSearch, 2026-10-31): "Japanese AI model predicts aesthetic brain response trained on 800,000 people"; "FitCheck outfit app AI aesthetic model simulated human reactions University of Maryland"; "Japan AI predicts brain activity response to images ads design without fMRI ... NTT DATA Araya"; `"800,000" people AI model simulate human reactions aesthetic preference images startup` (extended); "80万人 データ 学習 AI 印象 予測 脳 画像 デザイン評価"; "感性AI 株式会社 学習データ ...". Result: NOT FOUND for the 800,000 figure and for a UMD FitCheck app.

Candidates, best match first:

| Candidate | What it is | Evidence | Fit for screenshots | Availability |
|---|---|---|---|---|
| NTT DATA NeuroAI / D-Planner (Japan) | "Virtual brain" that predicts brain responses and decoded impressions (verbs, nouns, adjectives) for videos, photos, audio; built with NICT on fMRI data | REPORTED: NTT DATA 2022 release (nttdata.com/jp/ja/news/services_info/2022/101900/) and Getty Images Japan case page, via search summaries; "over one million scenes" and "150+ companies" come from a search summary of a Japanese article I could not open (403) | photos yes, so a screenshot is plausible | commercial service, no public API or weights found (NOT FOUND, same searches) |
| Kansei AI (感性AI, Keio group, Tokyo) | Rates impressions of package design, names and copy on 43 adjective scales; trained on consumer survey data | kansei-ai.com fetched: "AI trained on consumer survey data", no respondent count, no API, no English, pricing by contact | images yes | commercial, Japanese only |
| Meta TRIBE v2 | Brain encoding model: predicts fMRI responses to video, audio and text | VERIFIED: arXiv 2605.04326 states "over 1,000 hours of fMRI across 720 subjects"; HF `facebook/tribev2` ungated, license cc-by-nc-4.0, 20,881 downloads | input is video; a scroll recording of a site is possible but this is research use, not an aesthetic score | open weights, non-commercial only |
| shunk031 simple-aesthetics-predictor (Japanese author) | Hugging Face port of the LAION CLIP aesthetic predictor | VERIFIED: GitHub 47 stars, MIT; HF `shunk031/aesthetics-predictor-v2-sac-logos-ava1-l14-linearMSE` 18,577 downloads | trained on photo/art ratings, weak on UI | local |

My read (labelled inference, not fact): "720 subjects" (TRIBE v2) or NTT's brain-data service are the likeliest sources of a garbled "800" figure. Ask the UMD friend for the app's model name or a link; that settles it in one message.

**Best open substitutes for scoring website screenshots** (recommendation does not depend on resolving the above):
1. **UIClip** (MIT): trained on website screenshots and human design-preference pairs; give it full-page screenshots in windows plus a one-line description. Use as a cheap filter, not the decider.
2. **Pairwise VLM council via OpenRouter**: each judge sees two directions side by side with a fixed rubric (hierarchy, type, spacing, story fit, distinctiveness vs. slop). Pairwise beats absolute scores for taste.
3. **Calibration set**: 20 to 30 Awwwards SOTD screenshots (scores are public on each site page, e.g. trionn-2) vs. 20 to 30 legacy school sites; a scorer that cannot separate these is useless. Collect by hand or with Vidyut's OK (Awwwards terms NOT CHECKED).
4. Skip LAION, NIMA and Q-Align as deciders: photo-trained or non-commercial.

## 4. Reference websites

Trionn VERIFIED (curl 20:28 EDT): 200, Next.js (`next/static` x303), `gsap`, `lenis` x5, `WebGL` x2 in the HTML; H1 text "Designed to mean something"; Awwwards page `sites/trionn-2` shows "Site of the Day - Jul 27, 2026"; older `sites/trionn` shows "Honorable Mention - Jan 26, 2024". What makes it good (from those signals): story-led copy, smooth-scroll plus GSAP choreography, WebGL accents, award-level jury scores.

Every site below returned HTTP 200 this run (curl or PowerShell, 20:31 to 20:32 EDT). The pattern column is my design reading from prior knowledge; I did not re-screenshot these pages this run (NOT CHECKED visually; S3 should capture them with Playwright).

| Site | Pattern to study |
|---|---|
| trionn.com | the bar: narrative hero, Lenis smooth scroll, GSAP reveals, WebGL accents |
| apple.com/airpods-pro | scroll-pinned product storytelling, sticky video scrubbing |
| apple.com/macbook-pro | huge type scale, section-by-section chapters, restraint |
| linear.app | dark product hero, precise type, subtle motion |
| stripe.com | gradient hero, dense but calm information design |
| vercel.com | grid systems, monochrome palette |
| raycast.com | bento feature grids, glossy detail |
| framer.com | motion-first marketing sections |
| lusion.co | WebGL-led studio site, interactive 3D hero |
| igloo.inc | immersive 3D scroll world |
| activetheory.net | experiential WebGL navigation |
| locomotive.ca | editorial type plus smooth scroll (makers of Locomotive Scroll) |
| rauno.me | craft micro-interactions, minimal personal site |
| awwwards.com/websites/education/ | category list for school and museum relevant references (e.g. smithsonian-institution nominee, 200) |

For the school audience, Apple-style chapters plus the Awwwards education category are more transferable than WebGL studios; keep WebGL as an optional accent.

## 5. Scraping: what is enough

Recommendation for legacy school sites (usually under a few hundred static pages, no bot walls): **Playwright (or crawl4ai) plus sitemap.xml, falling back to link crawl, plus dembrandt for tokens.** Cost: zero beyond compute. This depends on the site not blocking automation, which is typical for old school sites but NOT CHECKED on a real target yet.

Paid tools, prices VERIFIED from their pricing pages (WebFetch 20:33 EDT):
- **Firecrawl**: Free 1,000 credits/month; Hobby $19 (5,000); Standard $99 (100,000); Growth $399 (500,000); Scale $749 (1,000,000); 1 credit per page. Useful for clean markdown and the branding extraction code; hosted API avoids its AGPL.
- **Apify**: Free ($5 usage/month), Starter $19, Scale $199, Business $999; $0.20 per compute unit on Free/Starter.
- **Bright Data Web Unlocker**: $1.5 per 1K requests pay as you go; Scale $499/month (383K requests); free tier 5K requests/month.

Need the paid tools only when: the site sits behind Cloudflare or a bot wall (BLOCKED_FOR_AUTOMATION on Playwright), needs residential IPs or geo, or the run reaches thousands of sites. Respect robots.txt and site terms either way.

## 6. Prior art and competitors

| Company | What it does | Pricing | State |
|---|---|---|---|
| **Repaint** (repaint.com) | YC Summer 2023 (yc-oss dataset, 6,358 companies searched); website redesign tool: paste URL, describe the look, get a new hosted site, connect domain | Plus $25/mo, Pro $100/mo, Max $200/mo, 14-day trial (pricing page quoted) | VERIFIED; likeliest "YC-accepted company" (match to transcript is inference) |
| Redesignr.ai | full redesign from a URL | NOT CHECKED | REPORTED (tier 4 listings only) |
| Rewebly | instant redesign for small businesses and HoReCa | NOT CHECKED | REPORTED (Product Hunt, Indie Hackers) |
| REFRESH Labs | redesign product on Product Hunt | NOT CHECKED | REPORTED |
| 10Web | AI WordPress builder, raised $2M in 2021 | NOT CHECKED | REPORTED; no Penn State link found |
| Typedream | YC Winter 2020 AI site builder, listed as acquired | n/a | REPORTED |
| firecrawl/open-lovable | open-source URL-to-React clone | free (MIT) | VERIFIED |

Penn State VIP conference company raising $2M: NOT FOUND (searched: "Penn State startup AI website builder raises $2 million 2026", WebSearch, 2026-10-31). Ask Vidyut for the company name.

Gap we can own: every product above restyles from a URL. None found that does story-first rebuilding with judged directions; that differentiator is our claim, and it is UNRESOLVED until compared on the same input site.

## What this means / what to do

1. S1: Playwright plus sitemap, crawl4ai for text, dembrandt for tokens, screenshots via playwright-mcp. No paid scraper this weekend.
2. S3/S5: shadcn plus Magic UI plus Motion plus Lenis plus GSAP, with gsap-skills; Astrowind for static school sites.
3. Install trial (needs Vidyut's OK per item): impeccable, taste-skill, web-design-guidelines, playwright-mcp, chrome-devtools-mcp. Run a blind side-by-side on one school site before keeping any.
4. S4: UIClip filter plus pairwise VLM council, calibrated on SOTD vs. legacy screenshots. Do not wait on the "800,000" model.
5. Baseline to beat: run open-lovable and Repaint (trial) on the same legacy site.

## Not checked
- Script contents inside any skill repo (security audit before install).
- GSAP license terms; UICrit license; Awwwards terms of use.
- Visual review of reference sites this run.
- Firecrawl branding format docs (only code paths seen).
- Whether star counts on the fast-growing skill repos reflect real usage.

GOAL: G1 research met with gaps (aesthetic simulator UNRESOLVED; Penn State company NOT FOUND) · due Sun Nov 1 12:00 PDT · finished Sat Oct 31 17:35 PDT
COST: 49/40 web reads (18 WebSearch/WebFetch plus 31 direct curl/PowerShell page and API fetches; over by 9) plus about 95 GitHub/HF metadata API reads not counted · 3 files read · 22 commands · 0 sub-agents

CHECKED_AT: Sat Oct 31 20:34:54 EDT 2026
SUBJECT: research for website redesign agent pipeline (no repo)
CHECKED: GitHub API for every repo listed; HF API for uiclip, tribev2, one-align, aesthetic predictors; trionn.com, trion.com, crion.com; awwwards.com/sites/trionn and trionn-2; 14 reference URLs; arxiv.org/abs/2605.04326; HF UIClip card; repaint.com/website-redesign-tool; semiotic.com (unrelated, dropped); firecrawl.dev/pricing; apify.com/pricing; brightdata.com/pricing/web-unlocker; kansei-ai.com; yc-oss.github.io/api/companies/all.json
NOT CHECKED: skill script audits, GSAP/UICrit/Awwwards terms, visual review of references, NTT DATA primary pages (search summaries only)
UNRESOLVED: identity of the "800,000 people" aesthetic model (settle: ask the UMD friend for the model name); Penn State $2M company (settle: Vidyut names it); Q-Align license conflict (repo non-commercial vs HF card MIT)
