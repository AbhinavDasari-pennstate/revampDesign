import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, fixture, INVALID, SAMPLE, tmpRun } from './helpers.mjs';

const BAD = join(INVALID, 'inventory.bad.json');
const RUN = join(SAMPLE, '00-run.json');

for (const stage of ['story', 'art', 'council']) {
  test(`${stage} exits 2 on an inventory that fails its schema and names the file`, () => {
    const r = tmpRun();
    const res = cli([stage, '--run', r, '--in', RUN, '--in', BAD, '--out', join(r, 'out.json')]);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /inventory\.bad\.json/);
    assert.equal(existsSync(join(r, 'out.json')), false);
  });

  test(`${stage} with --max-usd 0 exits 4 before reading anything`, () => {
    const r = tmpRun();
    const res = cli([stage, '--run', r, '--in', RUN, '--out', join(r, 'out.json'), '--max-usd', '0']);
    assert.equal(res.status, 4, res.stderr);
    assert.equal(existsSync(join(r, 'out.json')), false);
  });
}

test('unknown stage exits 1 with usage', () => {
  const res = cli(['paint']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /usage:/);
});

test('a missing required input exits 2 and says which', () => {
  const r = tmpRun();
  const res = cli(['story', '--run', r, '--in', RUN, '--out', join(r, 'out.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /needs --in <inventory file>/);
});

test('a file that is not JSON exits 2', () => {
  const r = tmpRun();
  writeFileSync(join(r, 'x.json'), '{nope');
  const res = cli(['council', '--run', r, '--in', join(r, 'x.json'), '--out', join(r, 'out.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not valid JSON/);
});

test('inputs from two different runs exit 2', () => {
  const r = tmpRun();
  writeFileSync(join(r, 'run.json'), JSON.stringify({ ...fixture('00-run.json'), run_id: 'other-run' }));
  const res = cli(['story', '--run', r, '--in', join(r, 'run.json'), '--in', join(SAMPLE, '10-inventory.json'), '--out', join(r, 'out.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /different runs/);
});
