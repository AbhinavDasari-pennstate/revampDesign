import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { calibration, council, tally } from '../council/council.mjs';
import { check } from '../lib/contracts.mjs';
import { cli, fixture, load, SAMPLE, tmpRun } from './helpers.mjs';

const directions = fixture('30-directions.json');
const models = load(join(import.meta.dirname, '../models.json'));
const vote = (a, b, order_shown, judge, winner) => ({ a, b, order_shown, judge, winner, rationale: '' });
// The fixture's preview paths, written as tiny files in a temp run so the judges have something to read.
function withFakePreviews(run) {
  const d = structuredClone(directions);
  for (const x of d.directions) for (const k of ['desktop', 'mobile']) { x.previews[k] = `${x.direction_id}-${k}.png`; writeFileSync(join(run, x.previews[k]), 'x'); }
  return d;
}

test('tally reproduces the fixture verdict: ranking by wins, score, agreement', () => {
  const v = fixture('40-verdict.json');
  const t = tally(v.pairs);
  assert.deepEqual(t.ranking, v.ranking);
  assert.equal(t.agreement, v.agreement);
  assert.equal(t.tie, false);
});

test('position flips are counted and a tie at the top is reported', () => {
  const pairs = [
    vote('d1', 'd2', 'ab', 'j', 'd2'), vote('d1', 'd2', 'ba', 'j', 'd2'),
    vote('d1', 'd3', 'ab', 'j', 'd3'), vote('d1', 'd3', 'ba', 'j', 'd3'),
    vote('d2', 'd3', 'ab', 'j', 'd2'), vote('d2', 'd3', 'ba', 'j', 'd3'),
  ];
  const t = tally(pairs);
  assert.equal(t.flips, 1, 'd2 vs d3 changed with the order');
  assert.equal(t.tie, true, 'd2 and d3 both have 3 wins out of 4');
});

test('live council: 3 judges from 3 families, every pair in both orders, needs_human on low agreement', async () => {
  const run = tmpRun();
  const directions = withFakePreviews(run);
  let calls = 0;
  const families = new Set(models.judges.map((j) => j.family));
  assert.equal(families.size, 3);
  // Every judge always prefers whatever is shown first: maximal position bias.
  const ask = async ({ messages }) => { calls++; assert.equal(messages[1].content.filter((c) => c.type === 'image_url').length, 4); return '{"winner": "first", "rationale": "Clearer."}'; };
  const cal = join(run, 'report.json');
  writeFileSync(cal, JSON.stringify({ set_version: 'calibration-1', accuracy: 0.95, measured_at: '2026-11-04T10:00:00-08:00' }));
  const { doc, problems } = await council({ runDir: run, directions, ask, live: true, models, budget: { spent: 0.1234 }, calibrationFile: cal, log: () => {} });
  assert.equal(check(doc), null);
  assert.deepEqual(problems, []);
  assert.equal(calls, 18);
  assert.equal(doc.pairs.length, 18);
  assert.deepEqual(new Set(doc.judges.map((j) => j.family)), families);
  assert.equal(doc.agreement, 0.5);
  assert.equal(doc.needs_human, true);
  assert.equal(doc.calibration.passed, true);
  assert.equal(doc.cost_usd, 0.1234);
});

test('an unreadable judge reply counts as a tie, not a crash', async () => {
  const run = tmpRun();
  const { doc } = await council({ runDir: run, directions: withFakePreviews(run), ask: async () => 'I like both', live: true, models, log: () => {} });
  assert.ok(doc.pairs.every((p) => p.winner === 'tie'));
  assert.equal(doc.needs_human, true);
});

test('a missing preview stops the live council with exit 2 before any paid call', async () => {
  let calls = 0;
  await assert.rejects(council({ runDir: tmpRun(), directions, ask: async () => { calls++; return '{}'; }, live: true, models, log: () => {} }), (e) => e.exit === 2 && /preview files missing/.test(e.message));
  assert.equal(calls, 0);
});

test('calibration: missing report means not passed; below 0.90 means not passed', () => {
  assert.deepEqual(calibration(join(tmpRun(), 'none.json')), { set_version: 'none', accuracy: null, passed: false, measured_at: null });
  const f = join(tmpRun(), 'r.json');
  writeFileSync(f, JSON.stringify({ set_version: 's', accuracy: 0.89, measured_at: '2026-11-04T10:00:00-08:00' }));
  assert.equal(calibration(f).passed, false);
});

test('council CLI without --live uses the rule judge, always asks a human, and writes compare.html', () => {
  const r = tmpRun();
  const res = cli(['council', '--run', r, '--in', join(SAMPLE, '30-directions.json'), '--out', join(r, '40-verdict.json')]);
  assert.equal(res.status, 0, res.stderr);
  const v = load(join(r, '40-verdict.json'));
  assert.equal(check(v), null);
  assert.deepEqual(v.judges, [{ model_id: 'rules/contrast', family: 'rules' }]);
  assert.equal(v.needs_human, true);
  assert.equal(v.compare_path, 'b-design/compare.html');
  assert.match(readFileSync(join(r, v.compare_path), 'utf8'), /Three design directions/);
});
