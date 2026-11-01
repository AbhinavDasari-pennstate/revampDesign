# Contracts v1.0.0 (frozen at tag `contracts-v1.0.0`)

The only way lanes talk to each other. Owned by Lane A (Abhinav). Lanes B and C read these files as data and never import code from this folder.

| File in a run folder | Schema | Written by |
|---|---|---|
| `00-run.json` | `schemas/run.v1.schema.json` | orchestrator (A) |
| `10-inventory.json` | `schemas/inventory.v1.schema.json` | scout (A) |
| `20-storyboard.json` | `schemas/storyboard.v1.schema.json` | story (B) |
| `30-directions.json` | `schemas/directions.v1.schema.json` | art (B) |
| `40-verdict.json` | `schemas/verdict.v1.schema.json` | council (B) |
| `45-selection.json` | `schemas/selection.v1.schema.json` | orchestrator (A) |
| `50-handoff.json` | `schemas/handoff.v1.schema.json` | build (C) |

Field-level summary: `plan/lanes.md`, section "Contracts". The schema files are the truth.

## Rules baked into the schemas
- Every file starts with `contract`, `version` ("1.0.0") and `run_id`. No extra fields anywhere.
- Ids: pages `p01`, blocks `p01-b003`, images `p01-i02`, forms `p01-f01`, facts `f001`, sections `s001`, directions `d1` to `d3`.
- Paths are relative to the run folder, forward slashes, never absolute.
- Colours are lowercase `#rrggbb`. Directions has exactly three entries, and `reduced_motion_ok` must be true.
- A handoff with `status: "pass"` must have `qa.gates_passed: true`.

## Sample run: `fixtures/sample/`
Every lane builds against this until real runs land in `samples/` (from Wed Nov 4).

- Source: **Maple Grove High School**, a fictional legacy school site in `fixtures/sample-site/` (domain `maplegrove-hs.example`, phone in the 555 range). No real owner, no consent question.
- It has a dead Calendar link (404) and a contact form that needs a backend, so the dropped and flagged paths are exercised.
- Stand-ins: the direction previews are simple boards rendered with fallback fonts, and the handoff screenshots are copies of the chosen direction's previews (`d2`). The built pages under `c-build/site/dist/` are one-line placeholders.
- Rebuild it with `node lanes/a-scout/tools/make-sample-fixture.mjs` from the repo root. Do not hand-edit after the freeze.

`fixtures/invalid/` holds one broken file per schema, each failing for a single known reason.

## Validate
```
cd contracts && npm ci
node validate.mjs <file.json>          # schema check against the version the file declares
node validate.mjs --cross <run dir>    # every file, plus ids across files and that every path exists
node --test                            # this folder's tests
```
Exit 0 means valid, 2 means invalid. Used by the orchestrator and CI. Lanes B and C validate with their own Ajv copy, reading `schemas/` as JSON.

## Changing a contract
Open a GitHub issue labelled `contract-cr` with: contract, field, why, the fixture line that shows it, and whether it is additive. Abhinav rules within 12 hours (recorded in `plan/rulings.md`). Additive optional fields bump to v1.1.0. No breaking changes after Wed Nov 4, 09:00 PST.
