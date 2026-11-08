// b-design/compare.html: the three previews side by side with name, concept, council rank and a rationale.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function compareHtml(directions, verdict) {
  const rank = Object.fromEntries(verdict.ranking.map((r, i) => [r.direction_id, { ...r, place: i + 1 }]));
  const why = (id) => verdict.pairs.find((p) => p.winner === id)?.rationale ?? 'No pair won outright.';
  const cards = [...directions.directions].sort((a, b) => rank[a.direction_id].place - rank[b.direction_id].place).map((d) => {
    const r = rank[d.direction_id];
    // compare.html sits in b-design/, previews in b-design/previews/.
    const src = (p) => esc(p.replace(/^b-design\//, ''));
    return `<article>
  <h2><span class="place">${r.place}</span> ${esc(d.name)} <small>(${d.direction_id})</small></h2>
  <p>${esc(d.concept)}</p>
  <p class="score">Wins: ${r.wins}. Score: ${r.score}.</p>
  <img src="${src(d.previews.desktop)}" alt="${esc(d.name)} desktop preview" width="640">
  <img class="mobile" src="${src(d.previews.mobile)}" alt="${esc(d.name)} mobile preview" width="195">
  <p class="why"><strong>Council:</strong> ${esc(why(d.direction_id))}</p>
</article>`;
  }).join('\n');
  const note = verdict.needs_human
    ? '<p class="note"><strong>A person should pick.</strong> The council is not sure (low agreement, a tie, no vision judge or no passed calibration). Pick with <code>--pick d1</code>, <code>d2</code> or <code>d3</code>.</p>'
    : `<p class="note">Council pick: <strong>${esc(verdict.top_direction_id)}</strong>. Agreement ${verdict.agreement}.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design directions</title>
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #f6f6f4; color: #1b1b1b; }
  main { max-width: 1400px; margin: 0 auto; padding: 24px; }
  .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
  article { background: #ffffff; border: 1px solid #d0d0cc; border-radius: 8px; padding: 16px; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid #d0d0cc; margin-top: 12px; }
  .mobile { max-width: 40%; }
  .place { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #1b1b1b; color: #ffffff; }
  small, .score { color: #4d4d4d; }
  .note { background: #fff6d6; border: 1px solid #8a6d00; padding: 12px; border-radius: 6px; }
</style></head>
<body><main>
<h1>Three design directions</h1>
${note}
<div class="grid">
${cards}
</div>
</main></body></html>`;
}

export function writeCompare(runDir, directions, verdict) {
  mkdirSync(join(runDir, 'b-design'), { recursive: true });
  writeFileSync(join(runDir, verdict.compare_path), compareHtml(directions, verdict));
}
