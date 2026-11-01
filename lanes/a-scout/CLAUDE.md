# Lane A (a-scout), owned by Abhinav
Stay inside `lanes/a-scout/`. Never read, edit or run files in another lane's folder, `orchestrator/` or `contracts/` (contracts are read-only data: load the schemas and fixtures as JSON, never import their code).
Branch prefix: `lane-a/`. CI rejects any change outside this folder.
Your tasks, inputs and outputs: `plan/lanes.md` (Lane A) and `plan/plan.md`.
Hand-off is only through contract files written with `--out`. Post status in `lanes/a-scout/STATUS.md` by 21:00 PST daily.
Keys: `lanes/a-scout/.env` (never commit it).
