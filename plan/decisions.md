# Decisions ledger (read first; never propose anything REJECTED)
[LOCKED] Input is an existing website URL; output is a redesigned site delivered as a new repository | "put in a website and it needs to come out 10 times better" | 2026-10-31
[LOCKED] Not one agent: several trained, focused agents, a compact and niche version of the master workflow | "multiple trained agents doing what the master workflow does, more compact and more pointed" | 2026-10-31
[LOCKED] Pipeline: deep-dive research agent -> storyboard agent -> design PRD agent (3 options) -> judges + aesthetic simulator pick one -> focused builder -> final review/red team -> submission | user message 2026-10-31
[LOCKED] Judging and red teaming are part of the pipeline, reuse the master workflow's judging, red team and reviewers | same | 2026-10-31
[LOCKED] Quality bar: trion site (user typed "trionn.com"; earlier transcript said crion.com, VERIFY domain) or Apple-level design; must clear this bar, "Claude can do it" is not the answer because generic output is the problem | 2026-10-31
[LOCKED] Use master-finder for UI repos above 50 stars and for skills we lack; look at reference websites during the run | 2026-10-31
[LOCKED] Use the full master crew (finder, planner, designer, creator, builder, reviewer, auditor, guardian) | 2026-10-31
[PREFERENCE] Multi-model via OpenRouter (Codex code, Gemini visuals, Claude check, others on the council); keep the model per step in config | transcript 2026-10-31
[PREFERENCE] Test sites: Prism, Gallant, plus a real legacy school site; bar reference is trion | transcript 2026-10-31
[PREFERENCE] Story-first: sites are rebuilt around what the organisation does (storyboard like a video), not restyled | transcript 2026-10-31
[LOCKED] Timeline: skeleton this weekend, test on a real site by next Wed/Thu, training starts after | transcript 2026-10-31
[LOCKED] The "800,000 people" aesthetic model is Meta TRIBE v2 (per Abhinav, 2026-10-31). Still to verify: license (finder found CC BY-NC) and input type (video/audio/text, not screenshots) | "The 800,000 people's model is the Tribe V2 from Meta"
[PREFERENCE] Demand for this product is strong in the US (the VC/Penn State company is US-based, not India); US is the market to design for | Abhinav 2026-10-31
[LOCKED] Work is split across three people: Abhinav, Nirmal, and Aditya. No one touches another person's work in any form: separate folders, separate branches, hand-offs only through frozen file contracts | "Make sure none of us are going to interact with each other's work in any form or way" | 2026-11-01
[LOCKED] Push the plan and the initial setup to the GitHub repo Abhinav shares; gh CLI over HTTPS, no SSH | "My GH is working right now, so we don't need to use SSH anymore" | 2026-11-01
[LOCKED] Write a README of everything that happened so far | 2026-11-01
[LOCKED] Team: Abhinav (Lane A), Nirmal (Lane B), Aditya (Lane C). Repo: https://github.com/AbhinavDasari-pennstate/revampDesign | "the three teammates: me, Nirmal, and Aditya" | 2026-11-01
[LOCKED] Installs approved: ajv 8.20.0 (contracts/), Playwright (lanes/a-scout/) | "Both (Recommended)" | 2026-11-01
[LOCKED] Skip Gallant (no URL). Fixtures use a fictional legacy school site, Maple Grove High School (maplegrove-hs.example), served locally from contracts/fixtures/sample-site/ | "skip that. I dont have a Gallant URL" | 2026-11-01
[LOCKED] Build a tester web app: an invited tester enters their site URL and consent, watches the run, then views the redesign, report and compare page in the browser; it wraps the existing orchestrator. Supersedes the PRD line that put a sign-up site out of scope (accounts and billing stay out) | "Tester web app (Recommended)" | 2026-11-11
[LOCKED] First version runs locally on Abhinav's laptop (localhost); deploying to a host is a later task with its own approval | "Local first (Recommended)" | 2026-11-11
[LOCKED] Access: invite codes Abhinav hands out, required consent checkbox and owner name, one run per code per day, a total daily dollar cap | "Invite codes + caps (Recommended)" | 2026-11-11
[LOCKED] Tester runs use the free mode by default; paid models (--live) only when Abhinav flips a per-run switch | "Off by default (Recommended)" | 2026-11-11
