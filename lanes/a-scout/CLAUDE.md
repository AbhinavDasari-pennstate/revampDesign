# Lane A (a-scout), owned by Abhinav
Lane A owns `lanes/a-scout/`, `contracts/`, `orchestrator/`, `plan/`, `.github/` and the repo root files.
Never read, edit or run files in `lanes/b-design/` or `lanes/c-build/`. Read their output only as contract files in `runs/`.
Contracts are frozen at tag `contracts-v1.0.0`. After the freeze, change them only through an approved `contract-cr` issue with a version bump.
Branch prefix: `lane-a/`. CI rejects any change in another lane's folder.
Your tasks, inputs and outputs: `plan/lanes.md` (Lane A) and `plan/plan.md`.
Follow `plan/engineering-rules.md` on every change.
Post status in `lanes/a-scout/STATUS.md` by 21:00 PST daily.
Keys: `lanes/a-scout/.env` (never commit it).
