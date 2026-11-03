import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, crossErrors, schemaErrors } from '../../contracts/validate.mjs';
import { writeSelection } from './select.mjs';

const COPIED = ['inventory', 'storyboard', 'directions', 'verdict', 'handoff'];
const FOLDERS = ['a-scout', 'b-design', 'c-build'];
// stage name, contract file it produces
const STAGES = [
  ['scout', 'inventory'], ['story', 'storyboard'], ['art', 'directions'],
  ['council', 'verdict'], ['select', 'selection'], ['build', 'handoff'],
];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });

// Stub mode: copy the fixture into a new run folder. Never looks in lanes/ (real stages are T17).
export function runStub({ fixture, outDir, now = new Date() }) {
  for (const name of [FILES.run, ...COPIED.map((k) => FILES[k])]) {
    if (!existsSync(join(fixture, name))) throw fail(`fixture is missing ${join(fixture, name)}`, 1);
  }
  const run = readJson(join(fixture, FILES.run));
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/^(\d{8})T(\d{4}).*/, '$1-$2');
  const runId = `${stamp}-${run.site_slug}`;
  const runDir = join(outDir, runId);
  mkdirSync(runDir, { recursive: true });

  for (const key of COPIED) cpSync(join(fixture, FILES[key]), join(runDir, FILES[key]));
  for (const folder of FOLDERS) if (existsSync(join(fixture, folder))) cpSync(join(fixture, folder), join(runDir, folder), { recursive: true });
  writeJson(join(runDir, FILES.run), { ...run, run_id: runId, created_at: now.toISOString() });
  for (const key of COPIED) writeJson(join(runDir, FILES[key]), { ...readJson(join(runDir, FILES[key])), run_id: runId });

  const lines = [];
  for (const [stage, key] of STAGES) {
    if (stage === 'select') writeSelection(runDir, runId, now);
    const errors = schemaErrors(readJson(join(runDir, FILES[key])));
    if (errors.length) throw fail(`${FILES[key]} failed its schema:\n${errors.join('\n')}`, 2);
    lines.push(`STUB ${stage} ok ${FILES[key]}`);
  }
  const cross = crossErrors(runDir);
  if (cross.length) throw fail(`run folder failed the cross check:\n${cross.join('\n')}`, 2);
  writeFileSync(join(runDir, 'orchestrator.log'), lines.join('\n') + '\n');
  return { runId, runDir, lines };
}
