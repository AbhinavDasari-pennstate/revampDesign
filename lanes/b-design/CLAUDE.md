# Lane B (b-design), owned by Nirmal
Stay inside `lanes/b-design/`. Never read, edit or run files in another lane's folder, `orchestrator/` or `contracts/` (contracts are read-only data: load the schemas and fixtures as JSON, never import their code).
Branch prefix: `lane-b/`. CI rejects any change outside this folder.
Your tasks, inputs and outputs: `plan/lanes.md` (Lane B) and `plan/plan.md`.
Hand-off is only through contract files written with `--out`. Post status in `lanes/b-design/STATUS.md` by 21:00 PST daily.
Keys: `lanes/b-design/.env` (never commit it).
