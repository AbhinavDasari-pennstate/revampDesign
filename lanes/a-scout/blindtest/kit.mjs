// Blind test kit and scorer. Three versions of the home page (original, redesign, plain Claude baseline) are
// shuffled with a seeded PRNG, copied under neutral names and shown with no labels.
// results.json: { "sites": [ { "site": "<name>", "key": "<path to that run's blindtest/key.json, relative to results.json>",
//   "rankings": { "<reviewer>": ["B", "A", "C"] } } ] }  each ranking lists the letters best first.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

// Returns { key } after writing runDir/a-scout/blindtest/kit/ and runDir/a-scout/blindtest/key.json.
export function buildKit({ runDir, seed }) {
  const run = resolve(runDir);
  const read = (file) => {
    const path = join(run, file);
    if (!existsSync(path)) throw fail(`missing input file: ${path}`, 2);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  const original = read('10-inventory.json').pages?.[0]?.screenshots;
  const redesign = read('50-handoff.json').site?.pages?.[0]?.screenshots;
  if (!original || !redesign) throw fail('inventory or handoff has no first page screenshots', 2);
  const sources = {
    original: original,
    redesign: redesign,
    baseline: { desktop: 'a-scout/baseline/screens/index-desktop.png', mobile: 'a-scout/baseline/screens/index-mobile.png' },
  };
  for (const version of Object.values(sources)) {
    for (const rel of Object.values(version)) {
      if (!existsSync(join(run, rel))) throw fail(`missing screenshot: ${join(run, rel)}`, 2);
    }
  }
  const order = shuffle(Object.keys(sources), seed);
  const base = join(run, 'a-scout', 'blindtest');
  const kit = join(base, 'kit');
  mkdirSync(kit, { recursive: true });
  const versions = {};
  order.forEach((name, i) => {
    versions[LETTERS[i]] = name;
    for (const view of ['desktop', 'mobile']) copyFileSync(join(run, sources[name][view]), join(kit, `${LETTERS[i]}-${view}.png`));
  });
  writeFileSync(join(kit, 'index.html'), html());
  const key = { seed, versions };
  writeFileSync(join(base, 'key.json'), JSON.stringify(key, null, 2));
  return { key };
}

// Per site: how many reviewers ranked the redesign above the original and above the baseline.
// Pass needs exactly 5 reviewers: 4 of 5 over the original and 3 of 5 over the baseline.
export function score(results, baseDir = '.') {
  return (results.sites ?? []).map((entry) => {
    const { versions } = JSON.parse(readFileSync(resolve(baseDir, entry.key), 'utf8'));
    const letter = (name) => Object.keys(versions).find((l) => versions[l] === name);
    const [r, o, b] = ['redesign', 'original', 'baseline'].map(letter);
    const rankings = Object.entries(entry.rankings ?? {});
    for (const [reviewer, order] of rankings) {
      if ([...order].sort().join('') !== 'ABC') throw fail(`${entry.site}: ${reviewer} must rank A, B and C once each`, 2);
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
