import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossErrors, FILES } from '../../contracts/validate.mjs';
import { nodeNote, runReal } from '../lib/run.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../../contracts/fixtures/sample', import.meta.url));

// A fake lane CLI: copies the matching sample file into --out (run_id taken from R/00-run.json),
// or exits with a code, or writes an invalid file. `behavior` maps stage to 'ok', 'exit:N', 'invalid' or 'human'.
const fakeCli = (behavior, calls) => `
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const arg = (n) => a[a.indexOf(n) + 1];
const [stage, run, out] = [a[0], arg('--run'), arg('--out')];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a.map((x) => (x === run ? '<R>' : x.startsWith(run) ? path.relative(run, x) : x))) + '\\n');
const mode = ${JSON.stringify(behavior)}[stage] ?? 'ok';
if (mode.startsWith('exit:')) process.exit(Number(mode.slice(5)));
if (mode === 'notjson') {
  fs.writeFileSync(out, '{"contract": "inventory", ');
  process.exit(0);
}
if (mode === 'null') {
  fs.writeFileSync(out, 'null');
  process.exit(0);
}
if (mode === 'invalid') {
  fs.writeFileSync(out, '{"contract":"inventory","version":"1.0.0"}');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(sample)}, path.basename(out)), 'utf8'));
data.run_id = JSON.parse(fs.readFileSync(path.join(run, '00-run.json'), 'utf8')).run_id;
if (mode === 'wrongcontract') {
  const sel = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(sample)}, '45-selection.json'), 'utf8'));
  sel.run_id = data.run_id;
  fs.writeFileSync(out, JSON.stringify(sel));
  process.exit(0);
}
if (mode === 'badid') data.run_id = 'other-run';
if (mode === 'human') Object.assign(data, { needs_human: true, top_direction_id: 'd1' });
fs.writeFileSync(out, JSON.stringify(data));
const lane = path.basename(import.meta.dirname);
fs.cpSync(path.join(${JSON.stringify(sample)}, lane), path.join(run, lane), { recursive: true });
`;

// Builds a temp lanes root with fake CLIs for the lanes in `present`; returns a runner and readers.
function setup({ behavior = {}, present = ['a-scout', 'b-design', 'c-build'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orch-real-'));
  const calls = join(root, 'calls.log');
  const lanesRoot = join(root, 'lanes');
  for (const lane of present) {
    mkdirSync(join(lanesRoot, lane), { recursive: true });
    writeFileSync(join(lanesRoot, lane, 'cli.mjs'), fakeCli(behavior, calls));
  }
  const outDir = join(root, 'runs');
  const run = (...extra) => spawnSync(process.execPath, [cli, 'run', '--url', 'https://www.Example-School.org/about', '--tier', 'B',
    '--lanes-root', lanesRoot, '--out-dir', outDir, ...extra], { encoding: 'utf8' });
  const runDir = () => join(outDir, readdirSync(outDir)[0]);
  const argvs = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const called = () => argvs().map((a) => a[0]);
  const json = (f) => JSON.parse(readFileSync(join(runDir(), f), 'utf8'));
  return { root, run, runDir, called, argvs, json };
}
const cleanup = (s) => rmSync(s.root, { recursive: true, force: true });

test('all stages exit 0: outputs validated, run.json written, cross check passes', () => {
  const s = setup();
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(s.called(), ['scout', 'story', 'art', 'council', 'build']);
    const run = s.json(FILES.run);
    assert.equal(run.source_url, 'https://www.Example-School.org/about');
    assert.equal(run.site_slug, 'example-school-org');
    assert.equal(run.tier, 'B');
    assert.match(run.run_id, /^\d{8}-\d{4}-example-school-org$/);
    assert.deepEqual(crossErrors(s.runDir()), []);
    assert.equal(s.json(FILES.selection).chosen_by, 'council');
    assert.equal(readFileSync(join(s.runDir(), 'orchestrator.log'), 'utf8').trim(), r.stdout.trim());
  } finally {
    cleanup(s);
  }
});

test('each lane stage gets exactly the args plan.md Interfaces lists', () => {
  const s = setup();
  try {
    assert.equal(s.run().status, 0);
    const run = '00-run.json', inv = '10-inventory.json', sb = '20-storyboard.json', dirs = '30-directions.json';
    const a = (stage, ins, out) => [stage, '--run', '<R>', ...ins.flatMap((f) => ['--in', f]), '--out', out];
    assert.deepEqual(s.argvs(), [
      a('scout', [run], inv),
      a('story', [run, inv], sb),
      a('art', [run, inv, sb], dirs),
      a('council', [dirs], '40-verdict.json'),
      a('build', [run, inv, sb, dirs, '45-selection.json'], '50-handoff.json'),
    ]);
  } finally {
    cleanup(s);
  }
});

test('real run consent defaults to not recorded; --consent-note records it; empty note does not', () => {
  const none = 'No owner consent recorded for this run.';
  const cases = [[[], false, none], [['--consent-note', 'Principal emailed OK'], true, 'Principal emailed OK'], [['--consent-note', ''], false, none], [['--consent-note', '   '], false, none]];
  for (const [flags, ok, note] of cases) {
    const s = setup();
    try {
      assert.equal(s.run(...flags).status, 0);
      assert.deepEqual(s.json(FILES.run).consent, { owner_ok: ok, note });
    } finally {
      cleanup(s);
    }
  }
});

test('a stage that writes a valid file of another contract stops with exit 2 at that stage', () => {
  const s = setup({ behavior: { scout: 'wrongcontract' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2);
    assert.deepEqual(s.called(), ['scout']);
    assert.match(r.stderr, /scout/);
    assert.match(r.stderr, /10-inventory\.json/);
  } finally {
    cleanup(s);
  }
});

test('--url "" is a real run that fails URL validation with exit 2', () => {
  const s = setup();
  try {
    assert.equal(s.run('--url', '').status, 2);
    assert.deepEqual(s.called(), []);
  } finally {
    cleanup(s);
  }
});

test('stub mode rejects real-run flags with exit 2', () => {
  const s = setup();
  try {
    for (const flag of [['--url', 'https://x.example'], ['--tier', 'A'], ['--pick', 'd1'], ['--consent-note', 'x']]) {
      const r = spawnSync(process.execPath, [cli, 'run', '--stub', '--fixture', sample, '--out-dir', join(s.root, 'stubruns'), ...flag], { encoding: 'utf8' });
      assert.equal(r.status, 2, flag.join(' '));
      assert.match(r.stderr, new RegExp(flag[0]));
    }
  } finally {
    cleanup(s);
  }
});

test('a mixed real and stub run skips the cross check and logs it', () => {
  const s = setup({ present: ['a-scout', 'b-design'] });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CROSS skipped \(mixed real and stub stages\)/);
  } finally {
    cleanup(s);
  }
});

test('an all-real run still fails the cross check when ids disagree', () => {
  const s = setup({ behavior: { council: 'badid' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cross check/);
  } finally {
    cleanup(s);
  }
});

test('an all-stub run is cross checked', () => {
  const s = setup({ present: [] });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /CROSS skipped/);
    assert.deepEqual(crossErrors(s.runDir()), []);
  } finally {
    cleanup(s);
  }
});

for (const [code, meaning] of [[1, 'crash'], [2, 'input failed its schema'], [3, 'quality gate failed'], [4, 'budget cap hit']]) {
  test(`stage exit ${code} stops the run, names stage, owner, meaning and inputs, same exit code`, () => {
    const s = setup({ behavior: { art: `exit:${code}` } });
    try {
      const r = s.run();
      assert.equal(r.status, code);
      assert.deepEqual(s.called(), ['scout', 'story', 'art']);
      assert.match(r.stderr, /art/);
      assert.match(r.stderr, /Nirmal/);
      assert.match(r.stderr, new RegExp(meaning));
      for (const f of [FILES.run, FILES.inventory, FILES.storyboard]) assert.ok(r.stderr.includes(f), f);
    } finally {
      cleanup(s);
    }
  });
}

test('owner is named per lane: scout is Abhinav, build is Aditya', () => {
  for (const [stage, owner] of [['scout', 'Abhinav'], ['build', 'Aditya']]) {
    const s = setup({ behavior: { [stage]: 'exit:1' } });
    try {
      const r = s.run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(owner));
    } finally {
      cleanup(s);
    }
  }
});

test('exit 0 with an invalid file stops with exit 2', () => {
  const s = setup({ behavior: { scout: 'invalid' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2);
    assert.deepEqual(s.called(), ['scout']);
    assert.match(r.stderr, /10-inventory\.json/);
  } finally {
    cleanup(s);
  }
});

test('exit 0 with no output file stops with exit 2', () => {
  const s = setup({ behavior: { scout: 'exit:0' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2);
    assert.deepEqual(s.called(), ['scout']);
    assert.match(r.stderr, /10-inventory\.json/);
  } finally {
    cleanup(s);
  }
});

test('a missing lane CLI falls back to the fixture with a STUB line', () => {
  const s = setup({ present: ['a-scout', 'b-design'] });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(s.called(), ['scout', 'story', 'art', 'council']);
    assert.match(r.stdout, /STUB build \(lane not present\)/);
    assert.doesNotMatch(r.stdout, /STUB scout/);
    assert.equal(s.json(FILES.handoff).run_id, s.json(FILES.run).run_id);
    assert.ok(existsSync(join(s.runDir(), 'c-build')));
    assert.deepEqual(crossErrors(s.runDir()), []);
  } finally {
    cleanup(s);
  }
});

test('needs_human true with --pick d2 selects d2 chosen by human', () => {
  const s = setup({ behavior: { council: 'human' } });
  try {
    const r = s.run('--pick', 'd2');
    assert.equal(r.status, 0, r.stderr);
    const sel = s.json(FILES.selection);
    assert.equal(sel.direction_id, 'd2');
    assert.equal(sel.chosen_by, 'human');
  } finally {
    cleanup(s);
  }
});

test('no pick uses the council top pick and the log says how to override', () => {
  const s = setup({ behavior: { council: 'human' } });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    const sel = s.json(FILES.selection);
    assert.equal(sel.direction_id, 'd1');
    assert.equal(sel.chosen_by, 'council');
    assert.match(r.stdout, /needs a human/);
    assert.match(r.stdout, /--pick/);
  } finally {
    cleanup(s);
  }
});

test('a pick that is not d1, d2 or d3 exits 2 before any stage runs', () => {
  const s = setup();
  try {
    const r = s.run('--pick', 'd9');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--pick/);
    assert.deepEqual(s.called(), []);
  } finally {
    cleanup(s);
  }
});

test('a bad tier exits 2', () => {
  const s = setup();
  try {
    const r = s.run('--tier', 'Z');
    assert.equal(r.status, 2);
    assert.deepEqual(s.called(), []);
  } finally {
    cleanup(s);
  }
});

test('a run that stops on a failed stage still writes orchestrator.log with the failure line', () => {
  const s = setup({ behavior: { story: 'exit:3' } });
  try {
    assert.equal(s.run().status, 3);
    const log = readFileSync(join(s.runDir(), 'orchestrator.log'), 'utf8');
    assert.match(log, /^ok scout 10-inventory.json$/m);
    assert.match(log, /stage story failed with exit 3/);
    assert.match(log, /Nirmal/);
  } finally {
    cleanup(s);
  }
});

test('a stage output that is not valid JSON exits 2 with stage, owner and path, and is logged', () => {
  const s = setup({ behavior: { scout: 'notjson' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /scout/);
    assert.match(r.stderr, /Abhinav/);
    assert.match(r.stderr, /10-inventory.json/);
    assert.match(readFileSync(join(s.runDir(), 'orchestrator.log'), 'utf8'), /not valid JSON/);
  } finally {
    cleanup(s);
  }
});

test('a stage output of JSON null exits 2 and names the stage', () => {
  const s = setup({ behavior: { scout: 'null' } });
  try {
    const r = s.run();
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /stage scout/);
  } finally {
    cleanup(s);
  }
});

test('a retry in the same minute gets a fresh run id and never overwrites the first run folder', () => {
  const s = setup();
  try {
    const now = new Date('2026-11-03T20:15:30Z');
    const go = () => runReal({ url: 'https://school.example/', tier: 'B', outDir: join(s.root, 'runs'), lanesRoot: join(s.root, 'lanes'), fixture: sample, now });
    const first = go();
    const marker = join(first.runDir, 'marker.txt');
    writeFileSync(marker, 'keep');
    const second = go();
    const third = go();
    assert.deepEqual([first.runId, second.runId, third.runId], ['20261103-2015-school-example', '20261103-2015-school-example-2', '20261103-2015-school-example-3']);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
    for (const r of [second, third]) {
      assert.match(r.runId, /^[a-z0-9-]+$/);
      assert.equal(JSON.parse(readFileSync(join(r.runDir, FILES.run), 'utf8')).run_id, r.runId);
      assert.deepEqual(crossErrors(r.runDir), []);
    }
  } finally {
    cleanup(s);
  }
});

test('an older Node than .nvmrc gets a warning, the same or newer gets none', () => {
  assert.match(nodeNote('20.13.1', '24'), /Node 20.*Node 24/);
  assert.equal(nodeNote('24.0.0', '24'), null);
  assert.equal(nodeNote('25.1.0', '24'), null);
});
