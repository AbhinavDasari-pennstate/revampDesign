// Blind test kit and scorer. Three versions of the home page (original, redesign, plain Claude baseline) are
// shuffled with a seeded PRNG, copied under neutral names and shown with no labels.
// results.json: { "sites": [ { "site": "<site_slug>", "key": "keys/<site_slug>.json",
//   "rankings": { "<reviewer>": ["B", "A", "C"] } } ] }  each ranking lists the letters best first.
// "key" is relative to results.json. Once review of a site ends, copy that run's a-scout/blindtest/key.json to
// blindtest/keys/<site_slug>.json (committed; runs/ is ignored) and point "key" at it. The key's site_slug must equal "site".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { outside } from '../../../contracts/validate.mjs';

const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });
const LETTERS = ['A', 'B', 'C'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a, so the same --seed usually orders different sites differently (only 6 orders exist).
const mix = (seed, slug) => [...slug].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, (2166136261 ^ seed) >>> 0);

export function shuffle(items, seed) {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const html = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website comparison</title>
<style>
body{font:16px system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#111}
h1{font-size:20px}h2{font-size:18px;margin:32px 0 8px}
.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
img{border:1px solid #bbb;max-width:100%;height:auto}
.desktop{flex:1 1 640px;min-width:0}.mobile{flex:0 1 240px}
</style></head><body>
<h1>Which page is best?</h1>
<p>Look at versions A, B and C, then rank them best first.</p>
${LETTERS.map((l) => `<h2>Version ${l}</h2>
<div class="row"><div class="desktop"><img src="${l}-desktop.png" alt="Version ${l} on desktop"></div>
<div class="mobile"><img src="${l}-mobile.png" alt="Version ${l} on a phone"></div></div>`).join('\n')}
</body></html>
`;

export const readJson = (path, ifMissing) => {
  if (!existsSync(path)) throw fail(`${ifMissing}: ${path}`, 2);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw fail(`${path} is not valid JSON`, 2);
  }
};

// Returns { key } after writing runDir/a-scout/blindtest/kit/ and runDir/a-scout/blindtest/key.json.
// Every input is checked before anything is written. Exit 2 on any bad input or a key made with another seed.
export function buildKit({ runDir, seed }) {
  const run = resolve(runDir);
  const read = (file) => readJson(join(run, file), 'missing input file');
  const slug = read('00-run.json')?.site_slug;
  if (typeof slug !== 'string' || !slug) throw fail(`${join(run, '00-run.json')} has no site_slug`, 2);
  const firstPage = (file, page) => {
    const shots = page?.screenshots;
    for (const view of ['desktop', 'mobile']) {
      if (typeof shots?.[view] !== 'string' || !shots[view]) throw fail(`${file} has no ${view} screenshot for its first page`, 2);
    }
    return shots;
  };
  const original = firstPage('10-inventory.json', read('10-inventory.json')?.pages?.[0]);
  const redesign = firstPage('50-handoff.json', read('50-handoff.json')?.site?.pages?.[0]);
  const sources = {
    original: original,
    redesign: redesign,
    baseline: { desktop: 'a-scout/baseline/screens/index-desktop.png', mobile: 'a-scout/baseline/screens/index-mobile.png' },
  };
  for (const version of Object.values(sources)) {
    for (const rel of Object.values(version)) {
      if (outside(run, rel)) throw fail(`screenshot path ${rel} is outside the run folder`, 2);
      if (!existsSync(join(run, rel))) throw fail(`missing screenshot: ${join(run, rel)}`, 2);
    }
  }
  const base = join(run, 'a-scout', 'blindtest');
  const keyPath = join(base, 'key.json');
  if (existsSync(keyPath)) {
    let earlier;
    try { earlier = JSON.parse(readFileSync(keyPath, 'utf8')); } catch { /* unreadable key, refused below */ }
    if (earlier?.seed !== seed || earlier?.site_slug !== slug) throw fail(`${keyPath} already exists with seed ${earlier?.seed} for site ${earlier?.site_slug}, not seed ${seed} for site ${slug}; answers already collected would be scored against changed letters (delete the key only if no answers were collected)`, 2);
  }
  const order = shuffle(Object.keys(sources), mix(seed, slug));
  const kit = join(base, 'kit');
  mkdirSync(kit, { recursive: true });
  const versions = {};
  order.forEach((name, i) => {
    versions[LETTERS[i]] = name;
    for (const view of ['desktop', 'mobile']) writeFileSync(join(kit, `${LETTERS[i]}-${view}.png`), readFileSync(join(run, sources[name][view])));
  });
  writeFileSync(join(kit, 'index.html'), html());
  const key = { seed, site_slug: slug, versions };
  writeFileSync(keyPath, JSON.stringify(key, null, 2));
  return { key };
}

// A key is only usable if it maps exactly A, B and C to the three versions and was made for this site.
function loadKey(entry, baseDir) {
  const path = resolve(baseDir, entry.key);
  const key = readJson(path, `${entry.site}: key file not found`);
  const versions = key?.versions;
  const plain = versions && typeof versions === 'object' && !Array.isArray(versions);
  if (!plain || Object.values(versions).some((v) => typeof v !== 'string') || Object.keys(versions).sort().join() !== 'A,B,C' || Object.values(versions).sort().join() !== 'baseline,original,redesign') {
    throw fail(`${entry.site}: ${path} needs "versions" mapping exactly A, B and C to original, redesign and baseline once each`, 2);
  }
  if (key.site_slug !== entry.site) throw fail(`${entry.site}: ${path} has site_slug ${JSON.stringify(key.site_slug)}, expected ${JSON.stringify(entry.site)}`, 2);
  return versions;
}

const isRanking = (order) => Array.isArray(order) && order.length === LETTERS.length && LETTERS.every((l) => order.filter((x) => x === l).length === 1);

// Per site: how many reviewers ranked the redesign above the original and above the baseline.
// Pass needs exactly 5 reviewers: 4 of 5 over the original and 3 of 5 over the baseline.
export function score(results, baseDir = '.') {
  if (!Array.isArray(results?.sites)) throw fail('results file needs a "sites" list', 2);
  return results.sites.map((entry) => {
    if (typeof entry.key !== 'string') throw fail(`${entry.site}: key must be the path to a key.json`, 2);
    const versions = loadKey(entry, baseDir);
    const letter = (name) => Object.keys(versions).find((l) => versions[l] === name);
    const [r, o, b] = ['redesign', 'original', 'baseline'].map(letter);
    const rankings = Object.entries(entry.rankings ?? {});
    for (const [reviewer, order] of rankings) {
      if (!isRanking(order)) throw fail(`${entry.site}: ${reviewer} must be a list ranking A, B and C once each`, 2);
    }
    const prefers = (other) => rankings.filter(([, order]) => order.indexOf(r) < order.indexOf(other)).length;
    const overOriginal = prefers(o);
    const overBaseline = prefers(b);
    return {
      site: entry.site,
      reviewers: rankings.length,
      over_original: overOriginal,
      over_baseline: overBaseline,
      pass_original: rankings.length === 5 && overOriginal >= 4,
      pass_baseline: rankings.length === 5 && overBaseline >= 3,
    };
  });
}
