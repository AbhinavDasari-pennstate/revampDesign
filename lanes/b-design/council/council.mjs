// Council: directions.v1 to verdict.v1. --live: three vision judges from three families compare every pair of
// previews in both orders (18 calls). Without --live a contrast-only rule judge runs and needs_human is always true,
// so the operator picks with --pick; it never pretends to be a design judgement.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson } from '../lib/openrouter.mjs';

const RUBRIC = readFileSync(join(import.meta.dirname, 'rubric.md'), 'utf8');
export const RUBRIC_VERSION = RUBRIC.match(/^version: (\S+)/m)?.[1] ?? 'rubric-1';
const PAIRS = [['d1', 'd2'], ['d1', 'd3'], ['d2', 'd3']];
const IDS = ['d1', 'd2', 'd3'];
const round2 = (x) => Math.round(x * 100) / 100;

export function tally(pairs) {
  const wins = Object.fromEntries(IDS.map((id) => [id, 0]));
  const ties = { ...wins };
  const seen = { ...wins };
  for (const p of pairs) {
    seen[p.a]++; seen[p.b]++;
    if (p.winner === 'tie') { ties[p.a]++; ties[p.b]++; } else wins[p.winner]++;
  }
  const ranking = IDS.map((id) => ({ direction_id: id, wins: wins[id], score: seen[id] ? round2((wins[id] + ties[id] / 2) / seen[id]) : 0 }))
    .sort((x, y) => y.wins - x.wins || y.score - x.score || x.direction_id.localeCompare(y.direction_id));
  // Agreement: share of votes that match the majority winner of their pair.
  const groups = pairs.reduce((m, p) => m.set(p.a + p.b, [...(m.get(p.a + p.b) ?? []), p]), new Map());
  let majority = 0;
  for (const g of groups.values()) majority += Math.max(...[...IDS, 'tie'].map((w) => g.filter((p) => p.winner === w).length));
  // Position flips: the same judge picked differently when the order was swapped.
  let flips = 0;
  for (const p of pairs) if (p.order_shown === 'ab' && pairs.some((q) => q.order_shown === 'ba' && q.judge === p.judge && q.a === p.a && q.b === p.b && q.winner !== p.winner)) flips++;
  return { ranking, agreement: pairs.length ? round2(majority / pairs.length) : 0, flips, tie: ranking[0].wins === ranking[1].wins };
}

export function calibration(file = join(import.meta.dirname, '../calibration/report.json')) {
  if (!existsSync(file)) return { set_version: 'none', accuracy: null, passed: false, measured_at: null };
  const r = JSON.parse(readFileSync(file, 'utf8'));
  return { set_version: r.set_version, accuracy: r.accuracy, passed: typeof r.accuracy === 'number' && r.accuracy >= 0.9, measured_at: r.measured_at };
}

const minContrast = (d) => Math.min(...d.contrast_checks.map((c) => c.ratio));

function ruleJudge(directions) {
  const by = Object.fromEntries(directions.map((d) => [d.direction_id, d]));
  return PAIRS.map(([a, b]) => {
    const [ra, rb] = [minContrast(by[a]), minContrast(by[b])];
    const winner = Math.abs(ra - rb) < 0.5 ? 'tie' : ra > rb ? a : b;
    return { a, b, order_shown: 'ab', judge: 'rules/contrast', winner, rationale: `Rules only, no vision judge: lowest contrast ${ra}:1 for ${a} and ${rb}:1 for ${b}.` };
  });
}

async function liveJudges(runDir, directions, ask, models, log) {
  const by = Object.fromEntries(directions.map((d) => [d.direction_id, d]));
  // Check every preview before the first paid call, so a missing file never wastes half a council.
  const missing = directions.flatMap((d) => [d.previews.desktop, d.previews.mobile]).filter((p) => !existsSync(join(runDir, p)));
  if (missing.length) throw Object.assign(new Error(`preview files missing in the run folder: ${missing.join(', ')}`), { exit: 2 });
  const image = (d, kind) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(join(runDir, d.previews[kind])).toString('base64')}` } });
  const pairs = [];
  for (const judge of models.judges) for (const [a, b] of PAIRS) for (const order of ['ab', 'ba']) {
    const [first, second] = order === 'ab' ? [by[a], by[b]] : [by[b], by[a]];
    const reply = await ask({ model: judge.model_id, messages: [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: [
        { type: 'text', text: 'First design, desktop then mobile:' }, image(first, 'desktop'), image(first, 'mobile'),
        { type: 'text', text: 'Second design, desktop then mobile:' }, image(second, 'desktop'), image(second, 'mobile'),
      ] },
    ] });
    let vote;
    try { vote = parseJson(reply); } catch { vote = {}; }
    const winner = vote.winner === 'first' ? first.direction_id : vote.winner === 'second' ? second.direction_id : 'tie';
    if (!['first', 'second', 'tie'].includes(vote.winner)) log(`council: ${judge.model_id} gave no readable vote for ${a} vs ${b} (${order}), counted as a tie`);
    pairs.push({ a, b, order_shown: order, judge: judge.model_id, winner, rationale: String(vote.rationale ?? 'No readable rationale.').slice(0, 400) });
  }
  return pairs;
}

export async function council({ runDir, directions, ask, live, models, budget, log = console.error, calibrationFile }) {
  const families = new Set(models.judges.map((j) => j.family));
  const problems = live && families.size < 3 ? [`models.json judges come from ${families.size} families, need 3`] : [];
  const pairs = live ? await liveJudges(runDir, directions.directions, ask, models, log) : ruleJudge(directions.directions);
  const { ranking, agreement, flips, tie } = tally(pairs);
  if (live) log(`council: ${flips} position flips out of ${pairs.length / 2} ordered pairs`);
  const cal = calibration(calibrationFile);
  const doc = {
    contract: 'verdict', version: '1.0.0', run_id: directions.run_id,
    judges: live ? models.judges.map(({ model_id, family }) => ({ model_id, family })) : [{ model_id: 'rules/contrast', family: 'rules' }],
    rubric_version: live ? RUBRIC_VERSION : 'rules-contrast-1',
    pairs, ranking, top_direction_id: ranking[0].direction_id, agreement,
    // A human decides when judges disagree, the top spot ties, no vision judge ran, or the judge is not calibrated.
    needs_human: !live || agreement < 0.67 || tie || !cal.passed,
    calibration: cal,
    compare_path: 'b-design/compare.html',
    cost_usd: Math.round((budget?.spent ?? 0) * 1e4) / 1e4,
  };
  return { doc, problems };
}
