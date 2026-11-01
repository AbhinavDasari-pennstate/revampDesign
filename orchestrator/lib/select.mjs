import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Council top pick becomes the selection. Operator pick arrives in T17.
export function writeSelection(runDir, runId, now) {
  const verdict = JSON.parse(readFileSync(join(runDir, '40-verdict.json'), 'utf8'));
  const selection = {
    contract: 'selection',
    version: '1.0.0',
    run_id: runId,
    direction_id: verdict.top_direction_id,
    chosen_by: 'council',
    reason: 'Top of the council ranking (stub run).',
    chosen_at: now.toISOString(),
  };
  writeFileSync(join(runDir, '45-selection.json'), JSON.stringify(selection, null, 2) + '\n');
}
