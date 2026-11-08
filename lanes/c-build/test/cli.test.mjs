// T12: the build CLI checks its inputs (exit 2) and its budget (exit 4) before doing any work.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemaErrors } from '../lib/contracts.mjs';

const CLI = join(import.meta.dirname, '..', 'cli.mjs');
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures');
const INPUTS = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A run folder holding the five sample inputs Lane C reads.
function sampleRun() {
  const run = mkdtempSync(join(tmpdir(), 'c-build-cli-'));
  dirs.push(run);
  for (const file of Object.values(INPUTS)) copyFileSync(join(FIXTURES, 'sample', file), join(run, file));
  return run;
}

function build(run, { ins = Object.values(INPUTS).map((f) => join(run, f)), extra = [] } = {}) {
  const args = [CLI, 'build', '--run', run, ...ins.flatMap((f) => ['--in', f]), '--out', join(run, '50-handoff.json'), ...extra];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

for (const [name, file] of Object.entries(INPUTS)) {
  test(`an invalid ${name} input exits 2 and names the file`, () => {
    const run = sampleRun();
    copyFileSync(join(FIXTURES, 'invalid', `${name}.bad.json`), join(run, file));
    const r = build(run);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes(join(run, file)), r.stderr);
    assert.equal(existsSync(join(run, '50-handoff.json')), false);
  });
}

test('an input that is not JSON exits 2 and names the file', () => {
  const run = sampleRun();
  writeFileSync(join(run, INPUTS.storyboard), '{ not json');
  const r = build(run);
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(join(run, INPUTS.storyboard)), r.stderr);
});

test('a missing --in for selection exits 2 and says which contract is missing', () => {
  const run = sampleRun();
  const ins = Object.values(INPUTS).filter((f) => f !== INPUTS.selection).map((f) => join(run, f));
  const r = build(run, { ins });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /selection/);
});

test('an unknown stage or a missing --out exits 2', () => {
  const run = sampleRun();
  assert.equal(spawnSync(process.execPath, [CLI, 'deploy', '--run', run], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, 'build', '--run', run, '--in', join(run, INPUTS.run)], { encoding: 'utf8' }).status, 2);
});

test('--max-usd 0 exits 4 and writes a valid handoff with status budget', () => {
  const run = sampleRun();
  const r = build(run, { extra: ['--max-usd', '0'] });
  assert.equal(r.status, 4, r.stderr);
  const handoff = JSON.parse(readFileSync(join(run, '50-handoff.json'), 'utf8'));
  assert.deepEqual(schemaErrors(handoff), []);
  assert.equal(handoff.status, 'budget');
  assert.equal(handoff.run_id, 'sample-0001');
  assert.equal(handoff.qa.gates_passed, false);
  assert.equal(handoff.cost_usd, 0);
  assert.ok(existsSync(join(run, handoff.report_path)), 'report written');
});

test('a zero Lane C budget in 00-run.json also exits 4', () => {
  const run = sampleRun();
  const doc = JSON.parse(readFileSync(join(run, INPUTS.run), 'utf8'));
  doc.limits.lane_budget_usd.c = 0;
  writeFileSync(join(run, INPUTS.run), JSON.stringify(doc));
  assert.equal(build(run).status, 4);
});

test('schemaErrors rejects a handoff that claims pass with failed gates', () => {
  const handoff = JSON.parse(readFileSync(join(FIXTURES, 'sample', '50-handoff.json'), 'utf8'));
  assert.deepEqual(schemaErrors(handoff), []);
  assert.notDeepEqual(schemaErrors({ ...handoff, qa: { ...handoff.qa, gates_passed: false } }), []);
});
