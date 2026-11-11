import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../lane-guard.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('lane-b may also touch web/ui but not web/viewer or web/server', () => {
  assert.deepEqual(violations('lane-b/x', ['web/ui/a.js', 'web/ui/css/app.css', 'lanes/b-design/a.mjs']), []);
  assert.deepEqual(violations('lane-b/x', ['web/viewer/a.js', 'web/server/server.mjs', 'contracts/web/README.md']), ['web/viewer/a.js', 'web/server/server.mjs', 'contracts/web/README.md']);
});

test('lane-c may also touch web/viewer but not web/ui or web/server', () => {
  assert.deepEqual(violations('lane-c/x', ['web/viewer/a.js', 'web/viewer/test/serve.test.mjs', 'lanes/c-build/a.mjs']), []);
  assert.deepEqual(violations('lane-c/x', ['web/ui/a.js', 'web/server/server.mjs', 'contracts/web/README.md']), ['web/ui/a.js', 'web/server/server.mjs', 'contracts/web/README.md']);
});

test('lane-a owns web/server and contracts/web but may touch neither web/ui nor web/viewer', () => {
  assert.deepEqual(violations('lane-a/x', ['web/server/server.mjs', 'contracts/web/README.md', 'contracts/test/web.test.mjs', '.gitignore']), []);
  assert.deepEqual(violations('lane-a/x', ['web/ui/a.js', 'web/viewer/a.js']), ['web/ui/a.js', 'web/viewer/a.js']);
});

test('a folder that only starts with the same letters as a web folder is not that folder', () => {
  assert.deepEqual(violations('lane-b/x', ['web/ui-extra/a.js', 'web/uix']), ['web/ui-extra/a.js', 'web/uix']);
  assert.deepEqual(violations('lane-c/x', ['web/viewer-extra/a.js', 'web/viewers']), ['web/viewer-extra/a.js', 'web/viewers']);
  assert.deepEqual(violations('lane-a/x', ['web/ui-extra/a.js', 'web/viewer-extra/a.js']), []);
});

test('CODEOWNERS names the web folder owners and .gitignore keeps web-data out of git', () => {
  const root = join(import.meta.dirname, '../../..');
  const owners = readFileSync(join(root, '.github/CODEOWNERS'), 'utf8').split(/\r?\n/).map((l) => l.trim().split(/\s+/));
  assert.ok(owners.some(([path, who]) => path === '/web/ui/' && who === '@Nirmal-28'));
  assert.ok(owners.some(([path, who]) => path === '/web/viewer/' && who === '@adithya916'));
  assert.ok(readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).includes('web-data/'));
});
