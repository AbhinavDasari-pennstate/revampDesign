import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildKit, score, shuffle } from '../blindtest/kit.mjs';

const CLI = join(import.meta.dirname, '../cli.mjs');
const RESULTS = join(import.meta.dirname, '../blindtest/results.json');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SHOTS = ['a-scout/screens/p01-desktop.png', 'a-scout/screens/p01-mobile.png', 'c-build/screens/home-desktop.png',
  'c-build/screens/home-mobile.png', 'a-scout/baseline/screens/index-desktop.png', 'a-scout/baseline/screens/index-mobile.png'];

const newRun = (slug = 'maplegrove-hs') => {
  const run = mkdtempSync(join(tmpdir(), 'blind-'));
  const write = (rel, data) => { mkdirSync(dirname(join(run, rel)), { recursive: true }); writeFileSync(join(run, rel), data); };
  write('00-run.json', JSON.stringify({ site_slug: slug }));
  SHOTS.forEach((rel, i) => write(rel, Buffer.concat([PNG, Buffer.from([i])])));
  write('10-inventory.json', JSON.stringify({ pages: [{ screenshots: { desktop: SHOTS[0], mobile: SHOTS[1] } }] }));
  write('50-handoff.json', JSON.stringify({ site: { pages: [{ screenshots: { desktop: SHOTS[2], mobile: SHOTS[3] } }] } }));
  return run;
};
const cli = (args) => spawnSync(process.execPath, [CLI, 'blindtest', ...args], { encoding: 'utf8' });

describe('blind test kit', () => {
  test('shuffle is deterministic per seed and differs across seeds', () => {
    const items = ['original', 'redesign', 'baseline'];
    assert.deepEqual(shuffle(items, 7), shuffle(items, 7));
    assert.deepEqual([...shuffle(items, 7)].sort(), [...items].sort());
    const orders = new Set(Array.from({ length: 20 }, (_, seed) => shuffle(items, seed).join()));
    assert.ok(orders.size > 1);
  });

  test('kit holds neutral copies and a page with no label, path or key; the key maps back to the bytes', () => {
    const run = newRun();
    const { key } = buildKit({ runDir: run, seed: 42 });
    const kit = join(run, 'a-scout/blindtest/kit');
    assert.deepEqual(readdirSync(kit).sort(), ['A-desktop.png', 'A-mobile.png', 'B-desktop.png', 'B-mobile.png', 'C-desktop.png', 'C-mobile.png', 'index.html']);
    const page = readFileSync(join(kit, 'index.html'), 'utf8');
    assert.doesNotMatch(page, /original|redesign|baseline|key|p01|home|index-|c-build|a-scout|\.json|seed/i);
    assert.deepEqual(JSON.parse(readFileSync(join(run, 'a-scout/blindtest/key.json'), 'utf8')), key);
    assert.equal(key.seed, 42);
    const source = { original: SHOTS[0], redesign: SHOTS[2], baseline: SHOTS[4] };
    for (const [letter, name] of Object.entries(key.versions)) {
      assert.deepEqual(readFileSync(join(kit, `${letter}-desktop.png`)), readFileSync(join(run, source[name])));
      assert.deepEqual(readFileSync(join(kit, `${letter}-mobile.png`)), readFileSync(join(run, source[name].replace('desktop', 'mobile'))));
    }
    rmSync(run, { recursive: true });
  });

  test('same seed gives the same key, another seed can differ', () => {
    const run = newRun();
    const keys = (seed) => buildKit({ runDir: run, seed }).key.versions;
    assert.deepEqual(keys(5), keys(5));
    assert.ok(new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(keys(s)))).size > 1);
  });

  test('kit file mtimes do not follow the source mtimes', () => {
    const run = newRun();
    SHOTS.forEach((rel, i) => utimesSync(join(run, rel), new Date(2020, 0, 1 + i * 100), new Date(2020, 0, 1 + i * 100)));
    buildKit({ runDir: run, seed: 9 });
    const kit = join(run, 'a-scout/blindtest/kit');
    const times = readdirSync(kit).filter((f) => f.endsWith('.png')).map((f) => statSync(join(kit, f)).mtimeMs);
    assert.ok(Math.max(...times) - Math.min(...times) < 60000);
    assert.ok(Math.min(...times) > new Date(2021, 0, 1).getTime());
  });

  test('the same seed orders different sites differently and the key records the slug', () => {
    const order = (slug) => buildKit({ runDir: newRun(slug), seed: 1 }).key;
    const slugs = ['maplegrove-hs', 'oak-academy', 'riverside-elementary', 'pine-ridge', 'st-marys'];
    assert.ok(new Set(slugs.map((s) => JSON.stringify(order(s).versions))).size > 1);
    assert.equal(order('pine-ridge').site_slug, 'pine-ridge');
  });

  test('a missing screenshot exits 2 and names the file', () => {
    const run = newRun();
    rmSync(join(run, 'a-scout/baseline/screens/index-mobile.png'));
    const r = cli(['--run', run, '--seed', '1']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /index-mobile\.png/);
  });

  test('the CLI builds the kit and a bad seed is a usage error', () => {
    const run = newRun();
    assert.equal(cli(['--run', run, '--seed', '3']).status, 0);
    assert.equal(cli(['--run', run, '--seed', 'x']).status, 1);
  });
});

describe('blind test scorer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blind-score-'));
  writeFileSync(join(dir, 'key.json'), JSON.stringify({ seed: 1, versions: { A: 'original', B: 'redesign', C: 'baseline' } }));
  const site = (name, rankings) => ({ site: name, key: 'key.json', rankings });
  const win = ['B', 'A', 'C']; // redesign first
  const loseBoth = ['A', 'C', 'B'];
  const beatOriginalOnly = ['C', 'B', 'A'];

  test('4 of 5 over the original and 3 of 5 over the baseline pass', () => {
    const [r] = score({ sites: [site('pass', { r1: win, r2: win, r3: win, r4: beatOriginalOnly, r5: loseBoth })] }, dir);
    assert.deepEqual(r, { site: 'pass', reviewers: 5, over_original: 4, over_baseline: 3, pass_original: true, pass_baseline: true });
  });

  test('3 of 5 over the original fails the first bar; 2 of 5 over the baseline fails the second', () => {
    const [r] = score({ sites: [site('fail', { r1: win, r2: win, r3: beatOriginalOnly, r4: loseBoth, r5: loseBoth })] }, dir);
    assert.equal(r.over_original, 3);
    assert.equal(r.over_baseline, 2);
    assert.equal(r.pass_original, false);
    assert.equal(r.pass_baseline, false);
  });

  test('fewer than 5 reviewers never passes; a bad ranking is rejected', () => {
    const [r] = score({ sites: [site('few', { r1: win, r2: win, r3: win, r4: win })] }, dir);
    assert.equal(r.pass_original, false);
    assert.throws(() => score({ sites: [site('bad', { r1: ['A', 'A', 'B'] })] }, dir), /list ranking A, B and C/);
  });

  test('a null ranking or a missing key exits 2 with a clear message', () => {
    assert.throws(() => score({ sites: [site('null', { r1: null })] }, dir), (e) => e.exitCode === 2 && /list ranking/.test(e.message));
    assert.throws(() => score({ sites: [{ site: 'nokey', rankings: {} }] }, dir), (e) => e.exitCode === 2 && /key/.test(e.message));
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ sites: [site('null', { r1: null })] }));
    const r = cli(['--score', '--results', file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /list ranking/);
  });

  test('the CLI scores a results file with a relative key path', () => {
    const file = join(dir, 'cli-results.json');
    writeFileSync(file, JSON.stringify({ sites: [site('cli', { r1: win, r2: win, r3: win, r4: beatOriginalOnly, r5: loseBoth })] }));
    const r = cli(['--score', '--results', file]);
    assert.equal(r.status, 0);
    const [row] = JSON.parse(r.stdout);
    assert.equal(row.over_original, 4);
    assert.equal(row.over_baseline, 3);
    assert.ok(row.pass_original && row.pass_baseline);
  });

  test('the committed results.json is the empty shape and the scorer accepts it', () => {
    assert.deepEqual(score(JSON.parse(readFileSync(RESULTS, 'utf8')), dirname(RESULTS)), []);
    const r = cli(['--score']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '[]');
  });
});
