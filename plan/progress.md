# Progress (main session)
| Task | Status | Commits | Review | Notes |
|---|---|---|---|---|
| T07 orchestrator stub | done | 2590797..f0cbff9 on lane-a/T07-orchestrator-stub | PASS after 1 fix round | run_id ruling in rulings.md; CI unverified on Node 24 |
| T08 scout crawl | done | e59ee43..8f81b62 on lane-a/T08-scout-crawl | PASS after 1 fix round (6 fixes) | div/span text rule added by ruling; CI unverified on Node 24 |
| T09 scout images, links, forms | done | a740c11 on lane-a/T09-scout-assets | PASS first round | follow-ups for T16/T25: parent-text label fallback can mislabel when the parent is the form; hidden-but-laid-out images wait 5 s each |
| T17 orchestrator real mode + --pick | done | 9915ae2..b74d72a + trim on lane-a/T17-orchestrator-real | PASS after 1 fix round | consent ruling (no consent unless --consent-note); mixed real/stub runs skip the end cross check; follow-ups: failed run writes no orchestrator.log, same-minute retry reuses the run folder, malformed stage JSON exits 1 not 2 |
