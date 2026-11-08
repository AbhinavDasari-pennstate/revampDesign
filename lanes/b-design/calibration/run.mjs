// Calibration (T27): can the council's judges tell award winning sites from legacy ones?
// capture: one screenshot per site and form factor into calibration/images/ (gitignored, never committed).
// judge: sampled award against legacy pairs, both orders, every judge, same rubric as the council.
// Accuracy is the share of votes for the award site; a tie counts as a miss. The council trusts it at 0.9 or more.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseJson } from '../lib/openrouter.mjs';

const HERE = import.meta.dirname;
export const MANIFEST = join(HERE, 'sites.json');
export const IMAGES = join(HERE, 'images');
export const REPORT = join(HERE, 'report.json');
const RUBRIC = readFileSync(join(HERE, '../council/rubric.md'), 'utf8');
const UA = 'RedesignAgent-LaneB-Calibration/1.0 (+https://github.com/AbhinavDasari-pennstate/revampDesign)';
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

export const loadManifest = (file = MANIFEST) => JSON.parse(readFileSync(file, 'utf8'));
export const shots = (site, dir = IMAGES) => ({ desktop: join(dir, `${site.id}-desktop.png`), mobile: join(dir, `${site.id}-mobile.png`) });
// A one colour viewport compresses to a few kilobytes; any real page is far larger.
export const looksBlank = (png) => png.length < 12000;

// Seeded shuffle so a sample can be repeated exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function samplePairs(sites, n, seed) {
  const award = sites.filter((s) => s.label === 'award');
  const legacy = sites.filter((s) => s.label === 'legacy');
  const all = award.flatMap((a) => legacy.map((l) => ({ award: a.id, legacy: l.id })));
  const rand = rng(seed);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, Math.min(n, all.length));
}

async function robotsAllows(url) {
  const u = new URL(url);
  if (u.host === 'web.archive.org') return true;
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return true;
    let applies = false;
    for (const raw of (await res.text()).split('\n')) {
      const [k, ...rest] = raw.replace(/#.*/, '').trim().split(':');
      const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k)) applies = v === '*';
      else if (applies && /^disallow$/i.test(k) && v && u.pathname.startsWith(v)) return false;
    }
    return true;
  } catch { return true; }
}

// One page load per site and form factor, 1 second between sites. A blank capture is retried with longer waits.
export async function capture(sites, dir = IMAGES) {
  mkdirSync(dir, { recursive: true });
  const failed = [];
  const browser = await chromium.launch();
  try {
    for (const site of sites) {
      const out = shots(site, dir);
      if (existsSync(out.desktop) && existsSync(out.mobile)) continue;
      if (!(await robotsAllows(site.url))) { failed.push({ id: site.id, reason: 'robots.txt disallows it' }); continue; }
      try {
        for (const [form, viewport] of Object.entries(VIEWPORTS)) {
          let png;
          for (const wait of [3000, 8000, 15000]) {
            const ctx = await browser.newContext({ viewport, userAgent: UA, serviceWorkers: 'block' });
            const page = await ctx.newPage();
            await page.goto(site.url, { waitUntil: 'load', timeout: 45000 });
            await page.waitForTimeout(wait);
            png = await page.screenshot();
            await ctx.close();
            if (!looksBlank(png)) break;
          }
          if (looksBlank(png)) throw new Error(`the ${form} capture stayed blank`);
          writeFileSync(out[form], png);
        }
      } catch (e) { failed.push({ id: site.id, reason: e.message.split('\n')[0] }); }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally { await browser.close(); }
  return failed;
}

// Votes: { judge, award, legacy, order ('award_first' | 'legacy_first'), winner ('award' | 'legacy' | 'tie'), rationale }.
export async function judgeCalibration({ ask, judges, pairs, sites, dir = IMAGES, log = console.error }) {
  const by = Object.fromEntries(sites.map((s) => [s.id, s]));
  const image = (file) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(file).toString('base64')}` } });
  const votes = [];
  for (const judge of judges) for (const p of pairs) for (const order of ['award_first', 'legacy_first']) {
    const [first, second] = (order === 'award_first' ? [p.award, p.legacy] : [p.legacy, p.award]).map((id) => shots(by[id], dir));
    const reply = await ask({ model: judge.model_id, messages: [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: [
        { type: 'text', text: 'First design, desktop then mobile:' }, image(first.desktop), image(first.mobile),
        { type: 'text', text: 'Second design, desktop then mobile:' }, image(second.desktop), image(second.mobile),
      ] },
    ] });
    let vote;
    try { vote = parseJson(reply); } catch { vote = {}; }
    if (!['first', 'second', 'tie'].includes(vote.winner)) log(`calibrate: ${judge.model_id} gave no readable vote for ${p.award} vs ${p.legacy}, counted as a tie`);
    const awardShownFirst = order === 'award_first';
    const winner = vote.winner === 'first' ? (awardShownFirst ? 'award' : 'legacy') : vote.winner === 'second' ? (awardShownFirst ? 'legacy' : 'award') : 'tie';
    votes.push({ judge: judge.model_id, award: p.award, legacy: p.legacy, order, winner, rationale: String(vote.rationale ?? '').slice(0, 300) });
  }
  return votes;
}

export function score(votes) {
  const acc = (vs) => (vs.length ? Math.round((vs.filter((v) => v.winner === 'award').length / vs.length) * 1000) / 1000 : null);
  const per_judge = Object.fromEntries([...new Set(votes.map((v) => v.judge))].map((j) => [j, acc(votes.filter((v) => v.judge === j))]));
  const accuracy = acc(votes);
  return { accuracy, passed: accuracy !== null && accuracy >= 0.9, votes: votes.length, ties: votes.filter((v) => v.winner === 'tie').length, per_judge };
}
