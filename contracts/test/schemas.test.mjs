import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMES, ajv, check, readJson } from './load.mjs';

test('all seven schemas compile under draft 2020-12', () => {
  for (const n of NAMES) assert.ok(ajv.getSchema(`${n}.v1`), `${n} missing`);
});

// Each invalid file breaks exactly one rule; the expected error must be among the errors.
const expected = {
  run: (e) => e.keyword === 'required' && e.params.missingProperty === 'run_id',
  inventory: (e) => e.instancePath === '/pages/0/blocks/0/block_id' && e.keyword === 'pattern',
  storyboard: (e) => e.keyword === 'required' && e.params.missingProperty === 'body_block_ids',
  directions: (e) => e.instancePath === '/directions' && e.keyword === 'minItems',
  verdict: (e) => e.instancePath === '/pairs/0/winner' && e.keyword === 'enum',
  selection: (e) => e.instancePath === '/chosen_by' && e.keyword === 'enum',
  handoff: (e) => e.instancePath === '/qa/gates_passed' && e.keyword === 'const',
};

for (const n of NAMES) {
  test(`invalid/${n}.bad.json fails for the expected reason`, () => {
    const errors = check(n, readJson(`fixtures/invalid/${n}.bad.json`));
    assert.ok(errors.some(expected[n]), JSON.stringify(errors, null, 2));
  });
}

test('a direction colour must be lowercase 6-digit hex', () => {
  const d = readJson('fixtures/sample/30-directions.json');
  d.directions[0].tokens.color.accent = '#FFF';
  assert.ok(check('directions', d).some((e) => e.instancePath.endsWith('/color/accent') && e.keyword === 'pattern'));
});
