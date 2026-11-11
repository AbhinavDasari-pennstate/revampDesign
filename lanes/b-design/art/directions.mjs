// Art director: three directions from the storyboard and the old site's brand. Tokens come from three fixed
// personalities; colours are fitted by code until every pair passes 4.5:1. --live lets a model rename and re-pitch
// each direction and pick its accent, then the same code re-checks contrast.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, fit } from '../lib/color.mjs';
import { fence, parseJson } from '../lib/openrouter.mjs';
import { scrub } from '../story/story.mjs';

const PROMPT = readFileSync(join(import.meta.dirname, 'prompt.md'), 'utf8');
export const BANNED = readFileSync(join(import.meta.dirname, 'banned.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim().toLowerCase());
const HEX = /^#[0-9a-f]{6}$/;

const PRESETS = [
  {
    direction_id: 'd1', name: 'Clear Path', fallback: '#1f5f3f',
    concept: 'Calm and civic. Generous type, plain sections, no motion. Built to pass WCAG 2.1 AA with room to spare.',
    color: { bg: '#f7f8f5', surface: '#ffffff', text: '#1d2a22', muted: '#55625a' },
    type: { display_family: 'Source Serif 4', body_family: 'Source Sans 3', source: 'google', scale_px: [16, 20, 28, 40], line_height: 1.5 },
    radius_px: 4, motion: () => 'none',
    layout: { grid: '12 column, 1120 px max', hero_pattern: 'headline left, logo right' },
    patterns: { news: 'dated list', events: 'dated list', contact: 'two column card', legal: 'plain notice', people: 'name list' },
    references: [{ url: 'https://www.gov.uk/', why: 'Plain language and accessible structure' }],
  },
  {
    direction_id: 'd2', name: 'Home Colors', fallback: '#003366',
    concept: 'School pride. The old site\'s own colours, bold headings, one subtle reveal on scroll.',
    color: { bg: '#ffffff', surface: '#f2f5f9', text: '#0f1f33', muted: '#4a5a6e' },
    type: { display_family: 'Archivo', body_family: 'Public Sans', source: 'google', scale_px: [16, 22, 32, 52], line_height: 1.5 },
    radius_px: 8, motion: (tier) => (tier === 'C' ? 'expressive' : 'subtle'),
    layout: { grid: '12 column, 1200 px max', hero_pattern: 'full width colour band with logo' },
    patterns: { news: 'three cards', story: 'image and text split', programs: 'card grid', contact: 'colour band' },
    references: [{ url: 'https://www.nasa.gov/', why: 'Confident colour bands and large headings' }],
  },
  {
    direction_id: 'd3', name: 'Bulletin', fallback: '#b3261e',
    concept: 'Editorial and type led, like a printed bulletin. Big dates, strong grid, no photos needed.',
    color: { bg: '#fbf9f4', surface: '#ffffff', text: '#222222', muted: '#5c5c5c' },
    type: { display_family: 'Fraunces', body_family: 'Atkinson Hyperlegible', source: 'google', scale_px: [17, 22, 34, 60], line_height: 1.5 },
    radius_px: 0, motion: () => 'none',
    layout: { grid: '6 column, 1080 px max', hero_pattern: 'oversized headline with date stamp' },
    patterns: { news: 'numbered bulletin', events: 'date column', story: 'two column text' },
    references: [{ url: 'https://www.theguardian.com/', why: 'Editorial type hierarchy and a strong grid' }],
  },
];

// Accents: d1 keeps its civic green, d2 takes the old primary, d3 the old accent, so the three never look alike.
function accents(inv) {
  const role = (r) => inv.brand.colors.find((c) => c.role === r && HEX.test(c.hex))?.hex;
  const used = [];
  for (const hex of [PRESETS[0].fallback, role('primary') ?? PRESETS[1].fallback, role('accent') ?? PRESETS[2].fallback]) {
    used.push(used.includes(hex) ? [PRESETS[2].fallback, '#6a3d9a', '#0b5563'].find((h) => !used.includes(h)) : hex);
  }
  return used;
}

function palette(base, accent, preferOn) {
  const c = { ...base };
  c.text = fit(fit(c.text, c.bg), c.surface);
  c.muted = fit(fit(c.muted, c.bg), c.surface);
  // Accent is used as link text on bg and as a button fill, so it must pass on both bg and white.
  c.accent = fit(fit(accent, '#ffffff'), c.bg);
  c.on_accent = preferOn && contrast(preferOn, c.accent) >= 4.5 ? preferOn : '#ffffff';
  return c;
}

const PAIRS = [['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['on_accent', 'accent'], ['accent', 'bg']];
export const contrastChecks = (c) => PAIRS.map(([fg, bg]) => ({ fg: c[fg], bg: c[bg], ratio: contrast(c[fg], c[bg]) }));

export function draftDirections(run, inv, sb, picks = {}) {
  const intents = [...new Set(sb.pages.flatMap((p) => p.sections.map((s) => s.intent)))];
  const photos = inv.pages.some((p) => p.images.some((im) => im.origin !== 'third_party' && im.width >= 300));
  const brandAccent = inv.brand.colors.find((c) => c.role === 'accent' && HEX.test(c.hex))?.hex;
  const acc = accents(inv);
  const directions = PRESETS.map((p, i) => {
    const pick = picks[p.direction_id] ?? {};
    const color = palette(p.color, HEX.test(pick.accent ?? '') ? pick.accent : acc[i], p.direction_id === 'd2' ? brandAccent : null);
    return {
      direction_id: p.direction_id,
      name: pick.name || p.name,
      concept: pick.concept || p.concept,
      tokens: { color, type: p.type, radius_px: p.radius_px, spacing_base_px: 8, motion: { level: p.motion(run.tier), reduced_motion_ok: true } },
      layout: { ...p.layout, hero_pattern: pick.hero_pattern || p.layout.hero_pattern,
        section_patterns: Object.fromEntries(intents.map((it) => [it, p.patterns[it] ?? 'stacked text'])) },
      references: p.references,
      // Site photos or type only here; with --live and no usable site photos, art/imagery.mjs adds Gemini images.
      imagery: { strategy: photos && p.direction_id !== 'd3' ? 'site_photos' : 'type_only', generated: [] },
      previews: { desktop: `b-design/previews/${p.direction_id}-desktop.png`, mobile: `b-design/previews/${p.direction_id}-mobile.png` },
      contrast_checks: contrastChecks(color),
    };
  });
  return { contract: 'directions', version: '1.0.0', run_id: run.run_id, directions, banned_patterns_checked: BANNED };
}

export function gate(doc, tier) {
  const problems = [];
  const names = doc.directions.map((d) => d.name.toLowerCase());
  const accentsUsed = doc.directions.map((d) => d.tokens.color.accent);
  if (new Set(names).size !== 3) problems.push('direction names are not distinct');
  if (new Set(accentsUsed).size !== 3) problems.push('direction accents are not distinct');
  for (const d of doc.directions) {
    for (const c of contrastChecks(d.tokens.color)) if (c.ratio < 4.5) problems.push(`${d.direction_id}: ${c.fg} on ${c.bg} is ${c.ratio}:1, below 4.5`);
    if (tier === 'A' && d.tokens.motion.level === 'expressive') problems.push(`${d.direction_id}: tier A allows no expressive motion`);
    const text = JSON.stringify(d).toLowerCase();
    for (const word of BANNED) if (text.includes(word)) problems.push(`${d.direction_id}: banned pattern "${word}"`);
    if (/[\u2013\u2014]/.test(JSON.stringify(d))) problems.push(`${d.direction_id}: has an em or en dash`);
  }
  return problems;
}

export async function art({ run, inventory, storyboard, ask, live, models, log = console.error }) {
  let picks = {};
  if (live) {
    const reply = await ask({ model: models.art, messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: fence('site', { organisation: scrub(storyboard.organisation, inventory), tier: run.tier, brand_colors: inventory.brand.colors, defaults: PRESETS.map(({ direction_id, name, concept, layout }) => ({ direction_id, name, concept, hero_pattern: layout.hero_pattern })) }) },
    ] });
    try {
      picks = Object.fromEntries(parseJson(reply).directions.map((d) => [d.direction_id, d]));
      const tried = draftDirections(run, inventory, storyboard, picks);
      const problems = gate(tried, run.tier);
      if (!problems.length) return { doc: tried, problems };
      log(`art: model picks failed checks, using the presets: ${problems.slice(0, 5).join('; ')}`);
    } catch (e) {
      log(`art: model reply unusable, using the presets: ${e.message}`);
    }
  }
  const doc = draftDirections(run, inventory, storyboard);
  return { doc, problems: gate(doc, run.tier) };
}
