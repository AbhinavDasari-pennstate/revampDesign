# Progress (main session)
| Task | Status | Commits | Review | Notes |
|---|---|---|---|---|
| T07 orchestrator stub | done | 2590797..f0cbff9 on lane-a/T07-orchestrator-stub | PASS after 1 fix round | run_id ruling in rulings.md; CI unverified on Node 24 |
| T08 scout crawl | done | e59ee43..8f81b62 on lane-a/T08-scout-crawl | PASS after 1 fix round (6 fixes) | div/span text rule added by ruling; CI unverified on Node 24 |
| T09 scout images, links, forms | done | a740c11 on lane-a/T09-scout-assets | PASS first round | follow-ups for T16/T25: parent-text label fallback can mislabel when the parent is the form; hidden-but-laid-out images wait 5 s each |
| T17 orchestrator real mode + --pick | done | 9915ae2..b74d72a + trim on lane-a/T17-orchestrator-real | PASS after 1 fix round | consent ruling (no consent unless --consent-note); mixed real/stub runs skip the end cross check; follow-ups: failed run writes no orchestrator.log, same-minute retry reuses the run folder, malformed stage JSON exits 1 not 2 |
| T16 scout facts, brand, injection | done | 0e8dd90..a48a673 on lane-a/T16-scout-facts-brand | PASS after 2 fix rounds | rulings: primary from header band, footer facts, legal footers; T25 follow-ups: oklch/color() computed colours, year rule hits '2000 students', email regex slow on 50k-char blocks |
| T26 plain Claude baseline | done | f146fbd..be3ef0e + dead-code removal on lane-a/T26-baseline | PASS after 2 fix rounds | renders untrusted reply over 127.0.0.1 with context route allowlist (Google Fonts only), SW blocked, WS closed; same inventory incl. images; waiting on Abhinav: model slug, Lane A key and cap; residual: a Google font host redirect would not be routed |
