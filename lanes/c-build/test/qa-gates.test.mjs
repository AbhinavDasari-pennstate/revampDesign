// T21: axe-core and Lighthouse gate the build. Serious or critical axe findings, or mobile Lighthouse
// accessibility under 95, fail it (exit 3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildPages } from '../builder/pages.mjs';
import { schemaErrors } from '../lib/contracts.mjs';
import { checkA11y } from '../qa/a11y.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const FILES = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };
const CLI = join(import.meta.dirname, '..', 'cli.mjs');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function sampleRun() {
  const run = mkdtempSync(join(tmpdir(), 'c-build-qa-'));
  dirs.push(run);
  for (const f of Object.values(FILES)) cpSync(join(SAMPLE, f), join(run, f));
  cpSync(join(SAMPLE, 'a-scout'), join(run, 'a-scout'), { recursive: true });
  return run;
}

test('the bad site fails: serious or critical axe findings and low mobile accessibility', async () => {
  const out = mkdtempSync(join(tmpdir(), 'c-build-qa-bad-'));
  dirs.push(out);
  const result = await checkA11y({
    dist: join(import.meta.dirname, 'bad-site'),
    pages: [{ slug: 'home', file: 'index.html' }],
    reportPath: join(out, 'axe.json'),
  });
  assert.ok(result.axe.serious + result.axe.critical > 0, JSON.stringify(result.axe));
  assert.equal(result.lighthouse.length, 1);
  assert.equal(result.lighthouse[0].form_factor, 'mobile');
  assert.ok(result.lighthouse[0].accessibility < 95, `accessibility ${result.lighthouse[0].accessibility}`);
  assert.equal(result.gates_passed, false);
  const report = read(join(out, 'axe.json'));
  assert.ok(report.pages[0].violations.some((v) => v.id === 'image-alt'), 'report names the failing rules');
});

test('the sample build passes: no serious or critical findings, mobile accessibility at least 95', async () => {
  const run = sampleRun();
  const docs = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(join(run, f))]));
  const { pages } = await buildPages({ runDir: run, docs });
  const result = await checkA11y({
    dist: join(run, 'c-build', 'site', 'dist'),
    pages: pages.map((p) => ({ slug: p.slug, file: basename(p.path) })),
    reportPath: join(run, 'c-build', 'axe.json'),
  });
  assert.equal(result.axe.serious, 0, JSON.stringify(read(join(run, 'c-build', 'axe.json'))));
  assert.equal(result.axe.critical, 0);
  assert.deepEqual(result.lighthouse.map((l) => l.slug), ['home', 'about', 'contact']);
  for (const l of result.lighthouse) {
    assert.equal(l.form_factor, 'mobile');
    assert.ok(l.accessibility >= 95, `${l.slug} accessibility ${l.accessibility}`);
    for (const k of ['performance', 'best_practices']) assert.ok(l[k] >= 0 && l[k] <= 100, `${l.slug} ${k}`);
  }
  assert.equal(result.gates_passed, true);
});

test('the CLI exits 3 when the chosen direction has unreadable text colours', () => {
  const run = sampleRun();
  const directions = read(join(run, FILES.directions));
  const picked = directions.directions.find((d) => d.direction_id === read(join(run, FILES.selection)).direction_id);
  picked.tokens.color.text = '#c8c8c8';
  picked.tokens.color.muted = '#d0d0d0';
  writeFileSync(join(run, FILES.directions), JSON.stringify(directions));
  const args = [CLI, 'build', '--run', run, ...Object.values(FILES).flatMap((f) => ['--in', join(run, f)]), '--out', join(run, '50-handoff.json')];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /color-contrast/);
  assert.ok(existsSync(join(run, 'c-build', 'axe.json')));
  // T23: a failed gate still hands over everything, marked as a fail.
  const handoff = read(join(run, '50-handoff.json'));
  assert.deepEqual(schemaErrors(handoff), []);
  assert.equal(handoff.status, 'fail');
  assert.equal(handoff.qa.gates_passed, false);
  assert.ok(handoff.qa.axe.serious > 0);
  assert.match(readFileSync(join(run, handoff.report_path), 'utf8'), /Not ready to publish[\s\S]*color-contrast/);
});
