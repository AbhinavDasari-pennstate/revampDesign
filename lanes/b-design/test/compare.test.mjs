import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';
import { compareHtml } from '../council/compare.mjs';
import { fixture, SAMPLE, tmpRun } from './helpers.mjs';

const directions = fixture('30-directions.json');
const verdict = fixture('40-verdict.json');

test('compare page shows the three previews ranked with name, concept, rank and rationale', () => {
  const html = compareHtml(directions, verdict);
  for (const d of directions.directions) {
    assert.match(html, new RegExp(`src="previews/${d.direction_id}-desktop.png" alt="${d.name} desktop preview"`));
    assert.ok(html.includes(d.concept));
  }
  assert.ok(html.indexOf('Mustang Gold') < html.indexOf('Orchard Road'), 'rank 1 first');
  assert.match(html, /Fixture vote: d2 reads as clearer/);
  assert.doesNotMatch(html, /A person should pick/);
  assert.match(compareHtml(directions, { ...verdict, needs_human: true }), /A person should pick/);
});

test('compare page passes axe with zero serious or critical violations', async () => {
  const r = tmpRun();
  cpSync(join(SAMPLE, 'b-design/previews'), join(r, 'previews'), { recursive: true });
  writeFileSync(join(r, 'compare.html'), compareHtml(directions, verdict));
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage(); // AxeBuilder needs a page from a context

    await page.goto(pathToFileURL(join(r, 'compare.html')).href);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(bad.map((v) => v.id), []);
  } finally {
    await browser.close();
  }
});
