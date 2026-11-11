// T05 manifest and T27 calibration scoring. Recorded judge replies only; no network, no browser.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { judgeCalibration, loadManifest, looksBlank, samplePairs, score, shots } from '../calibration/run.mjs';
import { calibration } from '../council/council.mjs';
import { LANE, cli } from './helpers.mjs';

const { sites } = loadManifest();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('manifest: exactly 25 award and 25 legacy entries, each with url, label and source', () => {
  for (const label of ['award', 'legacy']) assert.equal(sites.filter((s) => s.label === label).length, 25);
  assert.equal(sites.length, 50);
  for (const s of sites) for (const k of ['id', 'url', 'label', 'source', 'domain']) assert.ok(s[k], `${s.id} lacks ${k}`);
});

test('manifest: every award entry cites its Awwwards page', () => {
  for (const s of sites.filter((x) => x.label === 'award')) assert.match(s.source, /^https:\/\/www\.awwwards\.com\/sites\/[a-z0-9-]+$/, s.id);
});

test('manifest: unique domains, none under both labels, each matching its url', () => {
  assert.equal(new Set(sites.map((s) => s.domain)).size, 50);
  for (const s of sites) {
    const host = new URL(s.url.replace(/^https:\/\/web\.archive\.org\/web\/\d+if_\//, '')).hostname.replace(/^www\./, '');
    assert.equal(s.domain, host, s.id);
  }
});

test('TERMS.md names the Awwwards terms page read and keeps screenshots out of git', () => {
  assert.match(readFileSync(join(LANE, 'calibration/TERMS.md'), 'utf8'), /https:\/\/www\.awwwards\.com\/terms\//);
  assert.match(readFileSync(join(LANE, '../../.gitignore'), 'utf8'), /^lanes\/b-design\/calibration\/images\/$/m);
});

test('pair sampling is seeded, award against legacy, no repeats', () => {
  const one = samplePairs(sites, 100, 1);
  assert.equal(one.length, 100);
  assert.deepEqual(samplePairs(sites, 100, 1), one);
  assert.notDeepEqual(samplePairs(sites, 100, 2), one);
  assert.equal(new Set(one.map((p) => p.award + p.legacy)).size, 100);
});

test('a recorded six pair run scores accuracy per vote and per judge; a tie is a miss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-b-cal-'));
  for (const s of sites) for (const f of Object.values(shots(s, dir))) writeFileSync(f, PNG);
  const pairs = samplePairs(sites, 6, 7);
  const judges = [{ model_id: 'a/judge', family: 'a' }, { model_id: 'b/judge', family: 'b' }];
  // Judge a always picks the award site. Judge b gets the first pair wrong once and ties once on the second.
  const n = { 'a/judge': 0, 'b/judge': 0 };
  const ask = async ({ model }) => {
    const i = n[model]++;
    const awardFirst = i % 2 === 0;
    let w = awardFirst ? 'first' : 'second';
    if (model === 'b/judge' && i === 0) w = 'second';
    if (model === 'b/judge' && i === 3) w = 'tie';
    return JSON.stringify({ winner: w, rationale: 'r' });
  };
  const votes = await judgeCalibration({ ask, judges, pairs, sites, dir, log: () => {} });
  assert.equal(votes.length, 24);
  const r = score(votes);
  assert.equal(r.accuracy, 0.917);
  assert.deepEqual(r.per_judge, { 'a/judge': 1, 'b/judge': 0.833 });
  assert.equal(r.ties, 1);
  assert.equal(r.passed, true);
});

test('the council treats accuracy below 0.9 as not calibrated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-b-rep-'));
  const write = (accuracy) => { const f = join(dir, `${accuracy}.json`); writeFileSync(f, JSON.stringify({ set_version: 'calibration-1', accuracy, measured_at: '2026-11-09T10:00:00Z' })); return f; };
  assert.equal(calibration(write(0.89)).passed, false);
  assert.equal(calibration(write(0.9)).passed, true);
  assert.equal(score([{ judge: 'x', winner: 'award' }, { judge: 'x', winner: 'legacy' }]).passed, false);
});

test('a blank capture is recognised so it is retried', () => {
  assert.equal(looksBlank(PNG), true);
  assert.equal(looksBlank(Buffer.alloc(50000)), false);
});

test('calibrate with no mode exits 1; --live with a 0 cap exits 4', () => {
  assert.equal(cli(['calibrate']).status, 1);
  assert.equal(cli(['calibrate', '--live', '--max-usd', '0']).status, 4);
});
