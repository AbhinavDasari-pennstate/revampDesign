# Engineering rules for every builder and reviewer (all lanes)

Adapted from the Karpathy-inspired guidelines (github.com/forrestchang/andrej-karpathy-skills) plus our own. Every brief to master-builder and master-reviewer includes this file. Reviewers return FIX for any breach.

1. **Think before coding.** Write down your assumptions. If the task can be read two ways, say so and pick with a reason, or ask. If something simpler would do, say so.
2. **Simplest thing that passes the test.** No feature the task did not ask for. No abstraction with one user. No config option nobody asked for. No error handling for cases that cannot happen. If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Touch only the files the task lists. Do not reformat or "improve" nearby code. Remove only what your own change made unused; mention other dead code instead of deleting it.
4. **Goal driven.** Failing test first, then the smallest change that makes it pass. Done means the task's done criteria are met and shown with command output.
5. **Standard library first.** Node built-ins (`node:test`, `node:fs`, `node:http`, `fetch`) before any package. Only packages on the approved list, pinned exactly.
6. **Stay in your lane.** Never read, edit or run another lane's folder. Talk through contract files and the board.
7. **No slop.** No placeholder comments, no TODO without an owner and task id, no dead code, no copy-pasted blocks, no em or en dashes.
