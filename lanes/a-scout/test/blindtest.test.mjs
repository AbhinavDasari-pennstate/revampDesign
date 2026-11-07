import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
    const keys = (run, seed) => buildKit({ runDir: run, seed }).key.versions;
    const run = newRun();
    assert.deepEqual(keys(run, 5), keys(run, 5));
    assert.ok(new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(keys(newRun(), s)))).size > 1);
  });

  test('a run that already has a key with another seed is refused and nothing changes', () => {
    const run = newRun();
    buildKit({ runDir: run, seed: 5 });
    const base = join(run, 'a-scout/blindtest');
    const before = [join(base, 'key.json'), ...readdirSync(join(base, 'kit')).map((f) => join(base, 'kit', f))].map((f) => readFileSync(f));
    const r = cli(['--run', run, '--seed', '6']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists with seed 5/);
    const after = [join(base, 'key.json'), ...readdirSync(join(base, 'kit')).map((f) => join(base, 'kit', f))].map((f) => readFileSync(f));
    assert.deepEqual(after, before);
    assert.equal(cli(['--run', run, '--seed', '5']).status, 0);
  });

  test('a run whose slug changed after the key was made is refused, so letters cannot move', () => {
    const run = newRun('oak-school');
    const { key } = buildKit({ runDir: run, seed: 7 });
    writeFileSync(join(run, '00-run.json'), JSON.stringify({ site_slug: 'other-school' }));
    const r = cli(['--run', run, '--seed', '7']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
    assert.deepEqual(JSON.parse(readFileSync(join(run, 'a-scout/blindtest/key.json'), 'utf8')), key);
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

  test('the same seed usually orders different sites differently and the key records the slug', () => {
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

  test('bad input exits 2 with a clear message and writes no kit', () => {
    const handoff = (screenshots) => JSON.stringify({ site: { pages: [{ screenshots }] } });
    const inventory = (screenshots) => JSON.stringify({ pages: [{ screenshots }] });
    const cases = [
      ['missing 00-run.json', (run) => rmSync(join(run, '00-run.json')), /missing input file.*00-run\.json/],
      ['00-run.json is not JSON', (run) => writeFileSync(join(run, '00-run.json'), '{'), /00-run\.json is not valid JSON/],
      ['00-run.json has no site_slug', (run) => writeFileSync(join(run, '00-run.json'), '{}'), /site_slug/],
      ['10-inventory.json is not JSON', (run) => writeFileSync(join(run, '10-inventory.json'), 'oops'), /10-inventory\.json is not valid JSON/],
      ['inventory screenshots miss the mobile width', (run) => writeFileSync(join(run, '10-inventory.json'), inventory({ desktop: SHOTS[0] })), /10-inventory\.json.*mobile/],
      ['50-handoff.json is not JSON', (run) => writeFileSync(join(run, '50-handoff.json'), '{"site":'), /50-handoff\.json is not valid JSON/],
      ['50-handoff.json is null', (run) => writeFileSync(join(run, '50-handoff.json'), 'null'), /50-handoff\.json.*desktop/],
      ['handoff screenshots miss the mobile width', (run) => writeFileSync(join(run, '50-handoff.json'), handoff({ desktop: SHOTS[2] })), /50-handoff\.json.*mobile/],
      ['handoff screenshots miss the desktop width', (run) => writeFileSync(join(run, '50-handoff.json'), handoff({ mobile: SHOTS[3] })), /50-handoff\.json.*desktop/],
    ];
    for (const [name, damage, message] of cases) {
      const run = newRun();
      damage(run);
      assert.throws(() => buildKit({ runDir: run, seed: 1 }), (e) => e.exitCode === 2 && message.test(e.message), name);
      assert.equal(existsSync(join(run, 'a-scout/blindtest')), false, name);
    }
    const run = newRun();
    writeFileSync(join(run, '50-handoff.json'), 'null');
    assert.equal(cli(['--run', run, '--seed', '1']).status, 2);
  });

  test('the CLI builds the kit and a bad seed is a usage error', () => {
    const run = newRun();
    assert.equal(cli(['--run', run, '--seed', '3']).status, 0);
    assert.equal(cli(['--run', run, '--seed', 'x']).status, 1);
  });
});

describe('blind test scorer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blind-score-'));
  const goodKey = (name) => ({ seed: 1, site_slug: name, versions: { A: 'original', B: 'redesign', C: 'baseline' } });
  const keyFile = (name, key) => { writeFileSync(join(dir, `${name}.json`), typeof key === 'string' ? key : JSON.stringify(key)); return `${name}.json`; };
  const site = (name, rankings) => ({ site: name, key: keyFile(name, goodKey(name)), rankings });
  const exits2 = (fn, message) => assert.throws(fn, (e) => e.exitCode === 2 && message.test(e.message));
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

  test('a key value that is not a string, and a results file with no sites list, exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blind-'));
    writeFileSync(join(dir, 'k.json'), JSON.stringify({ seed: 1, site_slug: 's', versions: { A: ['redesign'], B: 'original', C: 'baseline' } }));
    const rankings = Object.fromEntries(['r1', 'r2', 'r3', 'r4', 'r5'].map((r) => [r, ['A', 'B', 'C']]));
    assert.throws(() => score({ sites: [{ site: 's', key: 'k.json', rankings }] }, dir), (e) => e.exitCode === 2);
    for (const body of ['null', '{"sitez":[]}', '{"sites":{}}', 'not json']) {
      writeFileSync(join(dir, 'r.json'), body);
      assert.equal(cli(['--score', '--results', join(dir, 'r.json')]).status, 2, body);
    }
    assert.equal(cli(['--score', '--results', join(dir, 'gone.json')]).status, 2);
  });

  test('a ranking is exactly three single letters A, B and C once each', () => {
    const bad = [['A', 'BC'], [['A'], 'B', 'C'], ['A', 'B'], ['A', 'B', 'C', 'A'], ['a', 'b', 'c'], [1, 2, 3], 'ABC', {}];
    for (const order of bad) exits2(() => score({ sites: [site('rank', { r1: order })] }, dir), /list ranking A, B and C/);
  });

  test('a key must map A, B and C to the three versions once each', () => {
    const bad = {
      'no redesign': { A: 'original', B: 'baseline', C: 'baseline' },
      'letter C missing': { A: 'original', B: 'baseline' },
      'unknown version': { A: 'original', B: 'redesign', C: 'plain' },
      'extra letter': { A: 'original', B: 'redesign', C: 'baseline', D: 'original' },
      'a list': ['original', 'redesign', 'baseline'],
      'a string': 'redesign',
    };
    for (const [name, versions] of Object.entries(bad)) {
      const entry = { site: 'k', key: keyFile('k', { ...goodKey('k'), versions }), rankings: { r1: ['B', 'A', 'C'] } };
      assert.throws(() => score({ sites: [entry] }, dir), (e) => e.exitCode === 2 && /versions/.test(e.message), name);
    }
  });

  test('a key from another site cannot score', () => {
    const entry = (key) => ({ site: 'a-school', key: keyFile('other', key), rankings: { r1: win } });
    exits2(() => score({ sites: [entry(goodKey('b-school'))] }, dir), /site_slug "b-school".*"a-school"/);
    exits2(() => score({ sites: [entry({ seed: 1, versions: goodKey('x').versions })] }, dir), /site_slug/);
    assert.equal(score({ sites: [entry(goodKey('a-school'))] }, dir)[0].site, 'a-school');
  });

  test('a missing key file, bad JSON in the key or a key without versions exits 2', () => {
    const entry = (key) => ({ site: 'k', key, rankings: { r1: win } });
    exits2(() => score({ sites: [entry('nope.json')] }, dir), /key file not found.*nope\.json/);
    exits2(() => score({ sites: [entry(keyFile('broken', '{'))] }, dir), /broken\.json is not valid JSON/);
    exits2(() => score({ sites: [entry(keyFile('novers', { site_slug: 'k' }))] }, dir), /versions/);
    exits2(() => score({ sites: [entry(keyFile('nullkey', 'null'))] }, dir), /versions/);
    const file = join(dir, 'missing-key-results.json');
    writeFileSync(file, JSON.stringify({ sites: [entry('nope.json')] }));
    const r = cli(['--score', '--results', file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /key file not found/);
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

  test('the committed results.json scores without error whatever it holds, and its keys are committed under keys/', () => {
    const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
    assert.equal(score(results, dirname(RESULTS)).length, results.sites.length);
    assert.ok(existsSync(join(dirname(RESULTS), 'keys')));
    for (const entry of results.sites) assert.match(entry.key, /^keys\/[^/\\]+\.json$/);
    const r = cli(['--score']);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).length, results.sites.length);
  });
});

test('a screenshot path that leaves the run folder exits 2 and copies nothing', () => {
  const run = newRun();
  const secret = join(run, '..', `${basename(run)}-secret.png`);
  writeFileSync(secret, 'secret');
  try {
    writeFileSync(join(run, '50-handoff.json'), JSON.stringify({ site: { pages: [{ screenshots: { desktop: `../${basename(secret)}`, mobile: SHOTS[3] } }] } }));
    assert.throws(() => buildKit({ runDir: run, seed: 1 }), (e) => e.exitCode === 2 && /outside the run folder/.test(e.message));
    assert.equal(existsSync(join(run, 'a-scout/blindtest')), false);
  } finally {
    rmSync(secret, { force: true });
  }
});
