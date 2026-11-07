import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { learn } from '../council/learn.mjs';
import { cli, fixture, SAMPLE, tmpRun } from './helpers.mjs';

test('learn appends one row per run with council rank versus the pick, and is idempotent per run_id', () => {
  const run = tmpRun();
  cpSync(join(SAMPLE, '45-selection.json'), join(run, '45-selection.json'));
  cpSync(join(SAMPLE, '40-verdict.json'), join(run, '40-verdict.json'));
  const other = tmpRun();
  writeFileSync(join(other, '45-selection.json'), JSON.stringify({ ...fixture('45-selection.json'), run_id: 'sample-0002', direction_id: 'd3', chosen_by: 'human' }));
  cpSync(join(SAMPLE, '40-verdict.json'), join(other, '40-verdict.json'));
  const out = join(tmpRun(), 'prefs.jsonl');

  assert.equal(learn([join(run, '45-selection.json'), join(other, '45-selection.json')], out).length, 2);
  assert.equal(learn([join(run, '45-selection.json')], out).length, 0, 'second run adds nothing');
  const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].picked, 'd3');
  assert.equal(rows[1].council_top, 'd2');
  assert.equal(rows[1].council_rank_of_pick, 3);
  assert.equal(rows[1].agreed, false);
});

test('learn CLI takes a shell glob: --in followed by bare paths', () => {
  const runs = [tmpRun(), tmpRun()];
  runs.forEach((r, k) => writeFileSync(join(r, '45-selection.json'), JSON.stringify({ ...fixture('45-selection.json'), run_id: `glob-${k}` })));
  const out = join(tmpRun(), 'p.jsonl');
  const res = cli(['learn', '--in', join(runs[0], '45-selection.json'), join(runs[1], '45-selection.json'), '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFileSync(out, 'utf8').trim().split('\n').length, 2);
});

test('learn CLI exits 2 on a file that is not a valid selection', () => {
  const res = cli(['learn', '--in', join(SAMPLE, '40-verdict.json'), '--out', join(tmpRun(), 'p.jsonl')]);
  assert.equal(res.status, 2, res.stderr);
});
