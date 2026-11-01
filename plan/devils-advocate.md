# G2 devil's advocate: website redesign agent pipeline

Checked Sat Oct 31 2026, 21:19 to 21:30 EDT (18:19 to 18:30 PDT) by master-planner, senior review in devil's advocate mode. Read first: plan/decisions.md, plan/board.md, plan/research.md. Nothing installed or cloned; skill files read through GitHub raw and API only. VERIFIED = primary source read this run (link given). REPORTED = from research.md or prior knowledge, not re-read. UNVERIFIED = my judgment or a fact I could not confirm.

## Summary (10 lines)

1. Verdict: **ship with changes**. The pipeline shape is sound; three of its load-bearing pieces are not.
2. **TRIBE v2: CUT from the product.** CC BY-NC 4.0 (VERIFIED), 720 subjects not 800,000 (VERIFIED), video/audio/text in, predicted fMRI for an "average" brain out (VERIFIED). It never outputs "people like this". Not even safe as an internal signal inside a paid pipeline.
3. **Replace it with** a pairwise VLM council (3 model families) plus a calibration set (25 Awwwards SOTD vs 25 legacy school sites) plus Vidyut as the human tiebreak. UIClip only as a "this is broken" floor.
4. **GSAP: SWAP to Motion plus CSS scroll-driven animation.** The free GSAP license prohibits use in tools that let users build animations without code in competition with Webflow and is revocable "in its discretion" (VERIFIED). An AI site builder is uncomfortably close to that line.
5. **crawl4ai: SWAP to plain Playwright plus sitemap.** Its license is Apache-2.0 plus an extra attribution clause that requires a credit in a commercial web app's About page (VERIFIED).
6. **Magic UI, Lenis, WebGL: CUT for schools.** Marquee, bento and globe are the exact AI-slop signature; smooth-scroll hijack and WebGL fight accessibility and weak devices.
7. **The legal bar for US public schools is WCAG 2.1 AA** under the DOJ ADA Title II rule, compliance Apr 26 2027 (50k+ population) or Apr 26 2028 (smaller) (VERIFIED). That is the real quality bar for tier A customers, and the best sales hook. trionn-style motion is the wrong ambition there.
8. **Skills: install none this week.** impeccable downloads and runs a closed platform binary and installs edit hooks; taste-skill symlinks to a live git pull and fetches third-party images; Vercel's skill fetches its rules from a mutable URL at runtime (all VERIFIED). Vendor their text at a pinned commit instead.
9. **Biggest gap in research.md: handoff.** A school comms office cannot run a repo. Without hosting plus content editing, nobody pays. Second gap: content fidelity (facts, legally required notices, photo rights).
10. Ship this week: Playwright plus dembrandt, Astro static output, Tailwind plus Radix primitives, Motion or CSS motion, axe-core plus Lighthouse budgets, pairwise VLM council, content-fidelity diff, static preview URL.

## 1. TRIBE v2 as the "800,000 people" aesthetic judge

| Claim to test | Finding | State | Source |
|---|---|---|---|
| License | CC BY-NC 4.0 on the weights (model card front matter) and the repo LICENSE file ("Attribution-NonCommercial 4.0 International") | VERIFIED | https://huggingface.co/facebook/tribev2 , https://github.com/facebookresearch/tribev2/blob/main/LICENSE |
| Commercial or hosted path | None offered on the model card or README; only a Meta research demo page. No contact-for-license line | VERIFIED absent on those two pages; UNVERIFIED that Meta would never grant one | same as above |
| Extra licence chain | Text encoder is gated Llama 3.2 3B, so the Llama community license also applies; video encoder is V-JEPA2 | VERIFIED (README names them and requires `huggingface-cli login` for Llama) | model card README |
| Training size | "over 1,000 hours of fMRI across 720 subjects". Nothing about 800,000 people | VERIFIED | https://arxiv.org/abs/2605.04326 |
| Inputs | video, audio, text (`video_path`, `audio_path`, `text_path`); no image input | VERIFIED | model card README |
| Output | `preds.shape == (n_timesteps, n_vertices)` on fsaverage5, about 20k cortical vertices, for the "average" subject | VERIFIED | model card README |
| Compute | Demo notebook asks for a GPU runtime; V-JEPA2 ViT-g plus Llama 3.2 3B plus Wav2Vec-BERT per call. Exact VRAM not stated | VERIFIED needs GPU; UNVERIFIED VRAM figure | tribe_demo.ipynb in the repo |

**Does predicted brain activity mean "people would like this design"?** No. The model predicts where cortex lights up, not preference, trust or clarity. To turn 20k vertices into a score you would have to fit a second model on human preference labels. If you have those labels, you train the scorer on them directly and TRIBE adds nothing but cost and a non-commercial licence. (Judgment, UNVERIFIED: no paper read this run links TRIBE outputs to design preference.)

**Is a scrolling site recording meaningful input?** Weakly at best. V-JEPA2 features come from natural video; a screen recording of a scrolling page is out of distribution, and the scroll speed you choose would change the "response". Two recordings of the same site at different speeds would score differently. (UNVERIFIED, judgment.)

**Internal research signal?** CC BY-NC defines non-commercial as not primarily intended for commercial advantage. Using it to pick which design a paying customer receives is commercial use even if the model never leaves your server. Only a separate, unpublished experiment that never feeds a customer decision is clean. (Licence text VERIFIED; the legal reading is mine, UNVERIFIED, get counsel before relying on it.)

**Verdict: CUT** from the pipeline. Optional offline curiosity only. Ask Abhinav where "800,000" came from; nothing on Meta's pages supports it.

**Best alternative, in order:**
1. **Pairwise VLM council** (emerging): three judges from different model families on OpenRouter, each sees two directions side by side (desktop and mobile screenshots plus a scroll capture as frames), fixed rubric: hierarchy, type, spacing, story fit, distinctiveness vs slop, accessibility. Randomise left/right to cancel position bias. Pairwise beats absolute scores for taste.
2. **Calibration set first** (the riskiest assumption in the whole project): 25 Awwwards SOTD sites vs 25 legacy school sites, plus 10 of our own outputs. If the council cannot rank SOTD above legacy at 90 percent or better, no judge is trustworthy yet.
3. **UIClip** (experimental: research model, last modified 2024-10-22, 1,314 downloads, MIT, VERIFIED via HF API) as a floor that flags obviously broken layouts. It was trained on deliberately degraded ("jittered") websites, so it detects bad, not award-level. Never the decider.
4. **Human panel**: Vidyut as tiebreak this week; later 5 people from the buyer side (a school comms director, parents) on the final 3 directions. This is the only judge a customer will believe.

## 2. Build blocks

| Block | Why it could hurt us | Evidence | Verdict |
|---|---|---|---|
| crawl4ai | Apache-2.0 plus a custom "Attribution Requirement": websites and web apps must credit UncleCode in an About or Credits section. Also a heavy Python stack for a job Playwright already does | VERIFIED https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE | SWAP: Playwright plus sitemap.xml |
| Playwright plus sitemap | Can be blocked by Cloudflare on some district platforms; otherwise boring and right | REPORTED (research.md section 5) | KEEP |
| dembrandt | Single small org (3.9k stars), ships an ONNX model; no postinstall hook (scripts are build/test only); depends on playwright-core 1.64.0. Old school tokens are often the problem, not the brand | VERIFIED https://raw.githubusercontent.com/dembrandt/dembrandt/HEAD/package.json | KEEP, pinned version; use logo and brand colours only, not spacing or type |
| shadcn/ui | Its default theme is the most recognisable AI-generated look on the web (UNVERIFIED, judgment). React-only, pushes a Next.js-style app onto content sites | MIT REPORTED | KEEP only as accessible primitives (Radix menus, dialogs, tabs) with our own tokens; ban the default theme |
| Magic UI | Marquee, bento grid, globe, shimmer button: the slop signature we are fighting; adds Motion-based JS to every section | MIT REPORTED; slop claim is judgment | CUT |
| Motion | MIT core; tree-shakeable; respects reduced motion if we wire it | MIT REPORTED | KEEP for small, purposeful transitions; prefer CSS first |
| Lenis | Replaces native scroll; on low-end Chromebooks and screen readers this is a cost with no school benefit | MIT REPORTED; impact UNVERIFIED (not measured) | CUT for tier A; tier C only |
| GSAP | Free licence bars "tools that allow users to build visual animations without code" that compete with Webflow, and Webflow "may terminate this GSAP License and revoke your access in its discretion". Our product generates animated sites from a URL with no code. Output sites may be fine as "any website", but the product itself is the risk | VERIFIED https://gsap.com/standard-license/ | SWAP: Motion plus CSS scroll-driven animations. Revisit only with a written answer from Webflow (their FAQ invites the question) |
| gsap-skills | Only useful if GSAP stays | MIT REPORTED | CUT (goes with GSAP) |
| react-three-fiber / WebGL | Large bundle, GPU-hungry, unlabelled canvas content fails WCAG unless given text alternatives | judgment, UNVERIFIED size | CUT for tier A; one accent behind a flag for tier C |
| screenshot-to-code | MIT, good prompts and eval loop, but its goal is fidelity to a screenshot, the opposite of "10 times better" | REPORTED | KEEP as reference only, not a dependency |
| open-lovable | Needs Firecrawl key plus an E2B or Vercel sandbox; a clone tool, not a redesign tool | REPORTED (README per research.md) | KEEP as the baseline to beat, never in the product |
| Next.js as output (trionn's stack) | Schools need static pages that any host or CMS can serve; a Node app is a hosting bill and a maintenance job | judgment | SWAP: Astro static output (MIT), React islands only where needed |

**Does trionn-style WebGL and GSAP motion suit a school website?** No, for public schools. Their pages are calendars, lunch menus, bus routes, staff directories, board minutes and enrolment forms, read by parents on phones, often in a second language, and the site must meet WCAG 2.1 AA by law (VERIFIED, https://www.ada.gov/resources/2024-03-08-web-rule/). WCAG 2.2.2 (Pause, Stop, Hide) already bites any auto-moving content longer than 5 seconds. trionn is a studio selling itself; a school is a utility with a story.

**Right ambition per customer:**
- **Tier A, public K-12 and districts:** "Apple restraint" plus gov.uk clarity. Story-led homepage (who we are, what a day here looks like, how to enrol), strong editorial type, real photography, under about 150 KB of JS, native scroll, CSS transitions with `prefers-reduced-motion`, axe-core clean. The wow is speed, clarity and a story, not motion.
- **Tier B, private schools, charters, small organisations recruiting (admissions, donors):** tier A plus one choreographed scroll chapter (Motion) and richer imagery.
- **Tier C, studios and brands that want awards:** trionn ambition, WebGL accents, smooth scroll, GSAP only after the licence question is answered.

## 3. Skills and MCP servers

Star inflation: impeccable 98,302 stars vs 215 watchers; taste-skill 107,053 stars vs 296 watchers (VERIFIED via GitHub API). That is about 450:1 and 360:1; I could not sample stargazer accounts (the stargazers API returned Not Found for every repo including shadcn, so the test was impossible from this token). Star authenticity stays UNVERIFIED. Treat stars as zero evidence; judge by blind output only.

| Item | What it actually runs | Prompt-injection / supply-chain risk | Overlap with what we have | Verdict |
|---|---|---|---|---|
| impeccable (Apache-2.0) | `scripts/impeccable` is a launcher that downloads a platform binary from GitHub releases (`IMPECCABLE_DOWNLOAD_BASE` overridable) and checks it against `engine-checksums.txt` in the same repo, so integrity rests on the same account that ships it. `hooks on` writes post-edit and Stop hooks into `.claude/settings.local.json` or `~/.claude/settings.json` that run the binary on every edit and inject system reminders into the agent | High: closed binary with our privileges, auto-injected context on every edit, a single maintainer account | The `reference/*.md` rules (critique, audit, craft-floor, polish) are the valuable part and overlap partly with frontend-design and web-design-engineer | SWAP: vendor `reference/critique.md`, `audit.md`, `craft-floor.md` as text at a pinned commit (keep the Apache NOTICE), no binary, no hooks |
| taste-skill (MIT) | `install.sh` symlinks into `~/.claude/skills` so every `git pull` silently changes agent instructions. `scripts/assets.mjs` pulls images from Openverse, archive.org and the Art Institute of Chicago API; `draw.mjs` uses picsum.photos; `lib/cdp.mjs` spawns a local Chrome | Medium to high: live-updating instructions; fetched images carry mixed licences (Openverse includes NC and ND works) and could ship inside a paid client site | Overlaps frontend-design and canvas-design for art direction | CUT this week. Later: read SKILL.md once, vendor its anti-slop rules as text; never its asset scripts |
| web-design-guidelines (Vercel) | SKILL.md tells the agent to WebFetch `vercel-labs/web-interface-guidelines/main/command.md` before each review and follow its "output format instructions" | Medium: instructions loaded from a mutable branch at runtime. Agent-skills repo has no licence on the API; the guidelines repo is MIT | Nothing we have covers this checklist; useful | SWAP: vendor `command.md` at commit 434b7f91364665f2f733b310ec54809bf8f37937 into our reviewer prompt |
| playwright-mcp (Microsoft, Apache-2.0) | Local browser automation | The pages it reads are attacker-controllable text: a scraped site can carry "ignore previous instructions" content into an agent that also has write tools | Paper and Figma MCP do not capture live sites; 21st MCP does not either | KEEP, but in the pipeline call Playwright as a library, not an MCP; use the MCP only for interactive debugging, pinned version, isolated profile |
| chrome-devtools-mcp (Google, Apache-2.0) | Google usage statistics enabled by default; performance tools may send trace URLs to the CrUX API (VERIFIED README, https://github.com/ChromeDevTools/chrome-devtools-mcp) | Low to medium: client URLs leave our machine by default | Overlaps playwright-mcp | SWAP in the pipeline: Lighthouse CLI plus axe-core (deterministic, scriptable). If used interactively, run with `--no-usage-statistics --no-performance-crux` |

**Minimal safe set:** no new skill installs. One new MCP at most (playwright-mcp, pinned, interactive use only). Vendored, pinned text from impeccable references and Vercel guidelines, loaded into our own reviewer prompt. Every install still needs Vidyut's explicit OK per item.

## 4. What the research misses that could sink the project

1. **Handoff to non-technical buyers.** The locked output is "a new repository". A school comms office cannot build, host or edit a repo, and many districts already pay for a hosted school CMS (Finalsite, Edlio, Apptegy and similar; market share UNVERIFIED). The thing they will pay for is a hosted, editable site or a theme for the CMS they already have. Test this in the first customer call, before more pipeline work.
2. **Content fidelity.** Scraped facts go stale or get "improved" by the writer model: wrong bell times, a dead staff member listed, a rewritten non-discrimination or Title IX notice. Fix: every text block on the new site carries the source URL it came from; S6 diffs facts (names, dates, phone numbers, addresses, legal notices) against the source and blocks on any change not approved by the customer.
3. **Rights in text and images.** Rebuilding a site you were hired to rebuild is fine; running it on a site you do not own for a cold demo is copying. Old school sites contain stock photos licensed to that site only and student photos governed by FERPA directory and photo consent (REPORTED, not checked this run). Rule: demos only on sites whose owner said yes, or on Prism and Gallant.
4. **Ownership of AI output.** The US Copyright Office's Part 2 report (Jan 29, 2025) addresses copyrightability of generative AI outputs (VERIFIED it exists, https://www.copyright.gov/ai/); purely AI-generated material is generally not protectable (REPORTED). Do not promise customers they "own" the design in a copyright sense without counsel.
5. **Prompt injection from scraped pages.** The research agent reads untrusted HTML; the builder writes files and runs a browser. Keep S1 tool-less (no write, no network beyond the target), pass scraped text as quoted data, and sandbox S5.
6. **Accessibility as the bar, not a check.** The WCAG 2.1 AA deadline (2027 and 2028) is a compliance reason to buy now. A redesign that fails axe-core is a liability for the school, not a deliverable.
7. **Model data handling.** OpenRouter routes to many providers; school content can include minors' names and photos. Prefer providers with zero data retention for any step that sees images of students (UNVERIFIED which ones qualify this week).
8. **No demand evidence yet.** Repaint already sells URL redesign at $25 to $200 a month (REPORTED). The story-first claim is unproven until the same school site goes through Repaint, open-lovable and us, judged blind.

## Verdict table

| Item | Verdict | One-line reason | Evidence link |
|---|---|---|---|
| TRIBE v2 | CUT (replace with pairwise VLM council plus calibration set plus human tiebreak) | Non-commercial licence, predicts fMRI not preference, video only | https://huggingface.co/facebook/tribev2 |
| UIClip | KEEP as floor filter only | MIT, trained on degraded UIs, detects broken not great | https://huggingface.co/biglab/uiclip_jitteredwebsites-2-224-paraphrased_webpairs_humanpairs |
| crawl4ai | SWAP (Playwright plus sitemap) | Extra attribution clause for commercial web apps | https://github.com/unclecode/crawl4ai/blob/main/LICENSE |
| Playwright plus sitemap | KEEP | Boring, enough for static school sites | research.md section 5 |
| dembrandt | KEEP (pinned) | MIT, no postinstall, useful for logo and colours | https://github.com/dembrandt/dembrandt/blob/HEAD/package.json |
| shadcn/ui | KEEP as primitives only | Accessible Radix base; default theme is slop | research.md section 1 |
| Magic UI | CUT | Its signature components are the generic AI look | research.md section 1 |
| Motion | KEEP | MIT, small, reduced-motion friendly | research.md section 1 |
| Lenis | CUT for schools | Scroll hijack, no school benefit | research.md section 1 |
| GSAP plus gsap-skills | SWAP (Motion plus CSS scroll-driven) | Prohibited-use clause near our product; revocable at Webflow's discretion | https://gsap.com/standard-license/ |
| react-three-fiber / WebGL | CUT for tier A | Weight and accessibility cost, no content value | judgment, UNVERIFIED |
| Next.js output | SWAP (Astro static) | Schools need static, cheap, portable hosting | judgment |
| screenshot-to-code | KEEP as reference | Fidelity tool, borrow eval loop only | https://github.com/abi/screenshot-to-code |
| open-lovable | KEEP as baseline | Clone tool to beat in a blind test | https://github.com/firecrawl/open-lovable |
| impeccable | SWAP (vendor reference text) | Downloads a closed binary, installs per-edit hooks | https://github.com/pbakaus/impeccable/tree/HEAD/.agent/skills/impeccable/scripts |
| taste-skill | CUT this week | Live symlinked updates, mixed-licence image fetching | https://github.com/Leonxlnx/taste-skill/blob/HEAD/install.sh |
| web-design-guidelines | SWAP (vendor at SHA 434b7f9) | Fetches rules from a mutable URL at runtime | https://github.com/vercel-labs/agent-skills/blob/HEAD/skills/web-design-guidelines/SKILL.md |
| playwright-mcp | KEEP (interactive only, pinned) | Proven, but pages are injection vectors | https://github.com/microsoft/playwright-mcp |
| chrome-devtools-mcp | SWAP (Lighthouse CLI plus axe-core in pipeline) | Usage statistics and CrUX calls on by default | https://github.com/ChromeDevTools/chrome-devtools-mcp |

## Top 3 risks

1. **Handoff kills revenue** (likely, fatal). Schools cannot use a repo. Fix: ask the first real school what they host on and who edits it, before Wednesday's test; plan a hosted static site plus simple editing, or a theme for their CMS.
2. **No judge can tell great from slop** (likely, kills the quality bar). TRIBE cannot, and nothing else is calibrated. Fix: build the 25 vs 25 calibration set on day 1 and gate the council at 90 percent pairwise accuracy before trusting S4.
3. **Content and legal errors on a school site** (medium likelihood, high impact): changed facts or legal notices, unlicensed photos, minors' data sent to model providers, WCAG failures. Fix: source-mapped content with a fact diff gate, demos only with owner consent, axe-core as a blocking S6 check.

## Minimal stack to ship this week

- **S1 research:** Playwright (library) plus sitemap.xml with link-crawl fallback, robots.txt respected; full-page screenshots desktop and mobile; dembrandt pinned for logo and colours; every text block stored with its source URL. S1 has no write or shell tools.
- **S2 storyboard and S3 PRD:** OpenRouter models per config; our existing frontend-design and web-design-engineer skills; vendored impeccable critique and craft-floor text; tier chosen up front (A, B or C) and passed to every later step.
- **S4 judge:** 3-family pairwise VLM council, randomised order, fixed rubric; calibration set 25 SOTD vs 25 legacy; UIClip floor optional; Vidyut breaks ties.
- **S5 build:** Astro static, Tailwind with our own tokens, Radix or shadcn primitives only for interactive parts, Motion or CSS for motion with reduced-motion; no Lenis, GSAP, Magic UI or WebGL on tier A.
- **S6 review:** axe-core (WCAG 2.1 AA, blocking), Lighthouse budgets (performance and accessibility), vendored Vercel guidelines at SHA 434b7f9, content-fidelity fact diff, master-reviewer and red team.
- **Handoff:** repo plus a deployed static preview URL plus a one-page "how to publish" note; hosted editing flagged as required before charging.

## Questions a sharp mentor would ask

- "Who signs the cheque at a school, and what do they host on today?" Honest answer: unknown; no customer interview is recorded in decisions.md.
- "Why not just use Repaint?" Honest answer: our story-first claim is untested; the blind side-by-side on one school site is the cheapest proof.
- "How do you know your judge is right?" Honest answer: we do not yet; the calibration set is how we will.

## Not checked

- Stargazer account quality (API returned Not Found); Webflow's answer on GSAP; TRIBE VRAM; CC BY-NC as applied to internal use (needs counsel); FERPA and COPPA details; school CMS market share; Motion and Magic UI bundle sizes; Awwwards terms for the calibration screenshots.

GOAL: G2 devils-advocate met (UNVERIFIED items labelled) · due Sun Nov 1 12:00 PDT · finished Sat Oct 31 18:30 PDT
COST: 22/25 lookups · 4 files read · 17 commands · 0 sub-agents
BOARD: - [21:30] planner G2: devil's advocate in plan/devils-advocate.md: CUT TRIBE v2 (CC BY-NC, fMRI not preference), SWAP GSAP and crawl4ai (licence clauses), no skill installs, WCAG 2.1 AA is the school bar | @main ask first school what they host on and who edits it; @designer tier A means no Lenis/GSAP/WebGL
