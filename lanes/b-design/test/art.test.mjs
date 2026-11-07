import assert from 'node:assert/strict';
import { test } from 'node:test';
import { art, BANNED, draftDirections, gate } from '../art/directions.mjs';
import { contrast, fit } from '../lib/color.mjs';
import { check } from '../lib/contracts.mjs';
import { draftStory } from '../story/story.mjs';
import { fixture } from './helpers.mjs';

const run = fixture('00-run.json');
const inv = fixture('10-inventory.json');
const sb = draftStory(run, inv);

test('contrast matches WCAG reference values', () => {
  assert.equal(contrast('#ffffff', '#000000'), 21);
  assert.equal(contrast('#777777', '#ffffff'), 4.48);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(contrast(fit('#ffcc00', '#ffffff'), '#ffffff') >= 4.5);
});

test('three valid directions with distinct names and accents, every contrast pair computed by code and at least 4.5', () => {
  const doc = draftDirections(run, inv, sb);
  assert.equal(check(doc), null);
  assert.deepEqual(gate(doc, 'A'), []);
  assert.equal(new Set(doc.directions.map((d) => d.name)).size, 3);
  assert.equal(new Set(doc.directions.map((d) => d.tokens.color.accent)).size, 3);
  for (const d of doc.directions) for (const c of d.contrast_checks) {
    assert.equal(c.ratio, contrast(c.fg, c.bg));
    assert.ok(c.ratio >= 4.5, `${d.direction_id} ${c.fg} on ${c.bg}`);
  }
  assert.equal(doc.directions[1].tokens.color.accent, '#003366', 'd2 uses the old site primary');
  assert.equal(doc.directions[1].tokens.color.on_accent, '#ffcc00', 'and the old accent when it passes');
});

test('tier A never gets expressive motion; tier C may', () => {
  for (const d of draftDirections(run, inv, sb).directions) assert.notEqual(d.tokens.motion.level, 'expressive');
  const c = draftDirections({ ...run, tier: 'C' }, inv, sb);
  assert.ok(c.directions.some((d) => d.tokens.motion.level === 'expressive'));
  assert.match(gate({ ...c }, 'A').join(), /tier A allows no expressive motion/);
});

test('a site with no brand colours or one colour still gets three distinct accents', () => {
  for (const colors of [[], [{ hex: '#1f5f3f', role: 'primary' }], [{ hex: '#003366', role: 'primary' }, { hex: '#003366', role: 'accent' }]]) {
    const doc = draftDirections(run, { ...inv, brand: { ...inv.brand, colors } }, sb);
    assert.deepEqual(gate(doc, 'A'), [], JSON.stringify(colors));
  }
});

test('banned patterns are listed and caught', () => {
  assert.ok(['marquee', 'bento', 'globe', 'shimmer'].every((w) => BANNED.includes(w)));
  const doc = draftDirections(run, inv, sb);
  doc.directions[0].concept = 'A bento grid with a shimmer.';
  assert.match(gate(doc, 'A').join(), /banned pattern "bento"/);
});

test('--live takes model names and accents but code fixes contrast; a banned reply falls back to presets', async () => {
  const reply = { directions: [
    { direction_id: 'd1', name: 'Quiet Commons', concept: 'Calm.', accent: '#88cc88', hero_pattern: 'stacked' },
    { direction_id: 'd2', name: 'Navy Pride', concept: 'Proud.', accent: '#003366' },
    { direction_id: 'd3', name: 'Front Page', concept: 'Editorial.', accent: '#c0392b' },
  ] };
  const { doc, problems } = await art({ run, inventory: inv, storyboard: sb, ask: async () => JSON.stringify(reply), live: true, models: { art: 'm' } });
  assert.deepEqual(problems, []);
  assert.equal(doc.directions[0].name, 'Quiet Commons');
  assert.ok(contrast(doc.directions[0].tokens.color.accent, '#ffffff') >= 4.5, 'light green was darkened by code');
  reply.directions[0].concept = 'A spinning globe hero.';
  const logs = [];
  const fallback = await art({ run, inventory: inv, storyboard: sb, ask: async () => JSON.stringify(reply), live: true, models: { art: 'm' }, log: (m) => logs.push(m) });
  assert.equal(fallback.doc.directions[0].name, 'Clear Path');
  assert.match(logs.join(), /globe/);
});
