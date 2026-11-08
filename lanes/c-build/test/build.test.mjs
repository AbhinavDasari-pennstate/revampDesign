// T13: the builder turns the storyboard and the selected direction into an Astro site in the run folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPages } from '../builder/pages.mjs';
import { selectedDirection } from '../builder/tokens.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const FILES = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

let runDir;
let docs;
let result;

// The sample with three changes, so nothing passes by matching template defaults or sample order:
// the operator picked d3 (the template default is d2), the nav order is reversed, and the copy has dashes.
before(async () => {
  runDir = mkdtempSync(join(tmpdir(), 'c-build-pages-'));
  for (const f of Object.values(FILES)) copyFileSync(join(SAMPLE, f), join(runDir, f));
  docs = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(join(runDir, f))]));
  docs.selection = { ...docs.selection, direction_id: 'd3', chosen_by: 'human' };
  docs.storyboard.nav.reverse();
  const [hero] = docs.storyboard.pages[0].sections;
  hero.copy.subhead = 'Grades 9\u201312 \u2014 about 640 students';
  docs.storyboard.pages[1].sections[0].copy.headline = 'Since 1962\u2014and counting';
  result = await buildPages({ runDir, docs });
});
after(() => rmSync(runDir, { recursive: true, force: true }));

const dist = () => join(runDir, 'c-build', 'site', 'dist');
const html = (file) => readFileSync(join(dist(), file), 'utf8');
const pageFile = (slug) => (slug === 'home' ? 'index.html' : `${slug}.html`);

test('one HTML page per storyboard slug, inside an Astro project in the run folder', () => {
  for (const { slug } of docs.storyboard.pages) assert.ok(existsSync(join(dist(), pageFile(slug))), `${slug} built`);
  assert.deepEqual(result.pages.map((p) => p.slug), docs.storyboard.pages.map((p) => p.slug));
  for (const f of ['package.json', 'astro.config.mjs', 'tokens.json', 'src']) assert.ok(existsSync(join(runDir, 'c-build', 'site', f)), `site has ${f}`);
});

test("the site's own package.json pins the same versions this lane builds with", () => {
  const lane = read(join(import.meta.dirname, '..', 'package.json')).dependencies;
  const site = read(join(runDir, 'c-build', 'site', 'package.json')).dependencies;
  for (const [name, version] of Object.entries(site)) assert.equal(version, lane[name], name);
});

test('every page has the nav in storyboard.nav order', () => {
  const expected = docs.storyboard.nav.map((n) => n.label);
  for (const { slug } of docs.storyboard.pages) {
    const nav = html(pageFile(slug)).match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)?.[0] ?? '';
    const labels = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim());
    assert.deepEqual(labels, expected, `${slug} nav`);
  }
});

test('links and assets are relative, so the site also works opened from disk', () => {
  for (const { slug } of docs.storyboard.pages) assert.doesNotMatch(html(pageFile(slug)), /(href|src)="\/(?!\/)/, slug);
});

test("the selected direction's accent and fonts are in the CSS", () => {
  const { tokens } = selectedDirection(docs.directions, docs.selection);
  const css = readdirSync(dist(), { recursive: true })
    .filter((f) => /\.(css|html)$/.test(f))
    .map((f) => readFileSync(join(dist(), f), 'utf8'))
    .join('\n');
  assert.equal(tokens.color.accent, '#b3261e');
  assert.match(css, /#b3261e/i);
  assert.match(css, /Fraunces/);
  assert.match(css, /Atkinson Hyperlegible/);
});

test('no em or en dash in any built HTML', () => {
  for (const f of readdirSync(dist(), { recursive: true }).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(html(f), /[\u2013\u2014]/, f);
  }
  assert.match(html('index.html'), /Grades 9-12, about 640 students/);
  assert.match(html('about.html'), /Since 1962, and counting/);
});

test('a selection naming a direction that is not in directions is exit 2', () => {
  assert.throws(() => selectedDirection(docs.directions, { ...docs.selection, direction_id: 'd9' }), (e) => e.exitCode === 2);
});

test('the build leaves nothing behind in .work', () => {
  assert.equal(existsSync(result.workDir), false);
});

test('the site JSON is written for the run, never edited in place in the template', () => {
  const template = readFileSync(join(import.meta.dirname, '..', 'template', 'src', 'data', 'site.json'), 'utf8');
  assert.doesNotMatch(template, /Maple Grove/);
});
