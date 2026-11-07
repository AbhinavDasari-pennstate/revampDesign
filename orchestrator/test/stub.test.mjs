import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossErrors, FILES } from '../../contracts/validate.mjs';
import { runStub } from '../lib/run.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../../contracts/fixtures/sample', import.meta.url));
const STAGES = ['scout', 'story', 'art', 'council', 'select', 'build'];

const run = (...args) => spawnSync(process.execPath, [cli, 'run', ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'orch-'));

test('stub run copies the sample into a new valid run folder', () => {
  const out = tmp();
  try {
    const r = run('--stub', '--fixture', sample, '--out-dir', out);
    assert.equal(r.status, 0, r.stderr);
    const [runId] = readdirSync(out);
    assert.match(runId, /^\d{8}-\d{4}-maplegrove-hs$/);
    const dir = join(out, runId);
    for (const f of Object.values(FILES)) assert.ok(existsSync(join(dir, f)), f);
    for (const d of ['a-scout', 'b-design', 'c-build']) assert.ok(existsSync(join(dir, d)), d);
    for (const f of Object.values(FILES)) assert.equal(JSON.parse(readFileSync(join(dir, f), 'utf8')).run_id, runId, f);
    assert.deepEqual(readFileSync(join(dir, 'c-build/axe.json')), readFileSync(join(sample, 'c-build/axe.json')));
    assert.deepEqual(crossErrors(dir), []);
    const log = readFileSync(join(dir, 'orchestrator.log'), 'utf8').trim().split('\n');
    assert.equal(log.length, STAGES.length);
    STAGES.forEach((s, i) => assert.ok(log[i].startsWith(`STUB ${s}`), log[i]));
    assert.equal(r.stdout.trim(), log.join('\n'));
    assert.equal(JSON.parse(readFileSync(join(dir, '45-selection.json'), 'utf8')).chosen_by, 'council');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a short fixture name resolves under contracts/fixtures', () => {
  const out = tmp();
  try {
    assert.equal(run('--fixture', 'sample', '--out-dir', out).status, 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a fixture missing 30-directions.json exits 1 and names the file', () => {
  const out = tmp();
  const fix = join(out, 'fixture');
  try {
    cpSync(sample, fix, { recursive: true });
    rmSync(join(fix, '30-directions.json'));
    const r = run('--fixture', fix, '--out-dir', join(out, 'runs'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /30-directions\.json/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('two stub runs in the same minute get separate folders', () => {
  const out = tmp();
  try {
    const now = new Date('2026-11-06T12:00:00Z');
    const first = runStub({ fixture: sample, outDir: out, now });
    const second = runStub({ fixture: sample, outDir: out, now });
    assert.equal(second.runId, `${first.runId}-2`);
    assert.equal(readdirSync(out).length, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
