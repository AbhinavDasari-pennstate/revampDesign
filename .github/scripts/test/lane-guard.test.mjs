import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../lane-guard.mjs';

test('lane-b may only touch lanes/b-design', () => {
  assert.deepEqual(violations('lane-b/x', ['lanes/b-design/a.mjs']), []);
  assert.deepEqual(violations('lane-b/x', ['lanes/c-build/a.mjs', 'contracts/x.json']), ['lanes/c-build/a.mjs', 'contracts/x.json']);
});

test('lane-c may only touch lanes/c-build', () => {
  assert.deepEqual(violations('lane-c/x', ['lanes/c-build/qa/a.mjs']), []);
  assert.deepEqual(violations('lane-c/x', ['README.md']), ['README.md']);
});

test('lane-a owns root, .github, plan, contracts, orchestrator, a-scout', () => {
  const ok = ['README.md', '.github/CODEOWNERS', 'plan/plan.md', 'contracts/x.json', 'orchestrator/cli.mjs', 'lanes/a-scout/cli.mjs'];
  assert.deepEqual(violations('lane-a/x', ok), []);
  assert.deepEqual(violations('lane-a/x', ['lanes/b-design/a.mjs']), ['lanes/b-design/a.mjs']);
});

test('unknown branch prefix fails everything', () => {
  assert.deepEqual(violations('feature/x', ['README.md']), ['README.md']);
});
