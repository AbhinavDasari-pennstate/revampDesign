# Lane C (c-build), owned by Aditya
Stay inside `lanes/c-build/`. Never read, edit or run files in another lane's folder, `orchestrator/` or `contracts/` (contracts are read-only data: load the schemas and fixtures as JSON, never import their code).
Branch prefix: `lane-c/`. CI rejects any change outside this folder.
Your tasks, inputs and outputs: `plan/lanes.md` (Lane C) and `plan/plan.md`.
Hand-off is only through contract files written with `--out`. Post status in `lanes/c-build/STATUS.md` by 21:00 PST daily.
Keys: `lanes/c-build/.env` (never commit it).
