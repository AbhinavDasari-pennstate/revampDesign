import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The operator's pick (d1, d2 or d3) wins; otherwise the council top pick. Returns the verdict's needs_human flag.
export function writeSelection(runDir, runId, now, pick) {
  const verdict = JSON.parse(readFileSync(join(runDir, '40-verdict.json'), 'utf8'));
  const selection = {
    contract: 'selection',
    version: '1.0.0',
    run_id: runId,
    direction_id: pick ?? verdict.top_direction_id,
    chosen_by: pick ? 'human' : 'council',
    reason: pick ? `Operator chose ${pick} with --pick.` : 'Top of the council ranking.',
    chosen_at: now.toISOString(),
  };
  writeFileSync(join(runDir, '45-selection.json'), JSON.stringify(selection, null, 2) + '\n');
  return verdict.needs_human;
}
