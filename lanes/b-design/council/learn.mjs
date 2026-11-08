// Preference log: one JSONL row per run comparing the council's pick with the final selection. Idempotent per run_id.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from '../lib/contracts.mjs';

export const DEFAULT_LOG = join(import.meta.dirname, '../data/preferences.jsonl');

export function learn(selectionFiles, out = DEFAULT_LOG) {
  const have = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).run_id) : []);
  const added = [];
  for (const file of selectionFiles) {
    const sel = JSON.parse(readFileSync(file, 'utf8'));
    const err = check(sel);
    if (err || sel.contract !== 'selection') throw Object.assign(new Error(`${file}: ${err ?? 'not a selection file'}`), { exit: 2 });
    if (have.has(sel.run_id)) continue;
    const vfile = join(dirname(file), '40-verdict.json');
    const v = existsSync(vfile) ? JSON.parse(readFileSync(vfile, 'utf8')) : null;
    if (v && check(v)) throw Object.assign(new Error(`${vfile}: ${check(v)}`), { exit: 2 });
    const place = v ? v.ranking.findIndex((r) => r.direction_id === sel.direction_id) + 1 : null;
    const row = { run_id: sel.run_id, picked: sel.direction_id, chosen_by: sel.chosen_by, council_top: v?.top_direction_id ?? null,
      council_rank_of_pick: place, agreed: v ? v.top_direction_id === sel.direction_id : null, needs_human: v?.needs_human ?? null, chosen_at: sel.chosen_at };
    mkdirSync(dirname(out), { recursive: true });
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    have.add(sel.run_id);
    added.push(row);
  }
  return added;
}
