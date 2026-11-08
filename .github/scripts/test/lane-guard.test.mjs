import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../lane-guard.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GUARD = join(import.meta.dirname, '../lane-guard.mjs');

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

test('a file moved out of another lane is caught, not hidden by rename detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir });
  mkdirSync(join(dir, 'contracts'));
  mkdirSync(join(dir, 'lanes/b-design'), { recursive: true });
  writeFileSync(join(dir, 'contracts/validate.mjs'), 'export const x = 1;\n'.repeat(20));
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-qc', 'lane-b/x');
  git('mv', 'contracts/validate.mjs', 'lanes/b-design/validate.mjs');
  git('commit', '-qm', 'move');
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_HEAD_REF: 'lane-b/x', GITHUB_BASE_REF: 'main' } });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contracts\/validate\.mjs/);
});
