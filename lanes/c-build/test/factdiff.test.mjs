// T22: every fact from the old site (phone, email, address, dates...) must survive into the new one,
// and every internal link must resolve. External links are checked but only reported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildPages } from '../builder/pages.mjs';
import { factDiff } from '../qa/factdiff.mjs';
import { checkLinks } from '../qa/links.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const FILES = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const okFetch = async () => ({ ok: true, status: 200 });

const dirs = [];
let built;
let docs;
let pages;

before(async () => {
  const run = mkdtempSync(join(tmpdir(), 'c-build-facts-'));
  dirs.push(run);
  for (const f of Object.values(FILES)) cpSync(join(SAMPLE, f), join(run, f));
  cpSync(join(SAMPLE, 'a-scout'), join(run, 'a-scout'), { recursive: true });
  docs = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(join(run, f))]));
  const result = await buildPages({ runDir: run, docs });
  built = join(run, 'c-build', 'site', 'dist');
  pages = result.pages.map((p) => ({ slug: p.slug, file: basename(p.path) }));
});
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A private copy of the built site with one page edited.
function editedSite(file, edit) {
  const dist = mkdtempSync(join(tmpdir(), 'c-build-facts-dist-'));
  dirs.push(dist);
  cpSync(built, dist, { recursive: true });
  writeFileSync(join(dist, file), edit(readFileSync(join(dist, file), 'utf8')));
  return dist;
}

test('the sample keeps every fact and every link', async () => {
  const facts = factDiff({ dist: built, pages, inventory: docs.inventory, storyboard: docs.storyboard });
  assert.deepEqual({ checked: facts.checked, changed: facts.changed, missing: facts.missing }, { checked: 8, changed: [], missing: [] });
  assert.deepEqual(facts.failures, []);
  const links = await checkLinks({ dist: built, pages, fetch: okFetch });
  assert.ok(links.checked > 0);
  assert.deepEqual(links.broken, []);
  assert.deepEqual(links.failures, []);
});

test('one changed phone digit fails, naming the fact id and the page', () => {
  const dist = editedSite('contact.html', (h) => h.replaceAll('010-0142', '010-0143').replaceAll('tel:5550100142', 'tel:5550100143'));
  const facts = factDiff({ dist, pages, inventory: docs.inventory, storyboard: docs.storyboard });
  assert.deepEqual(facts.changed, [{ fact_id: 'f001', before: '(555) 010-0142', after: '(555) 010-0143' }]);
  assert.equal(facts.failures.length, 1);
  assert.match(facts.failures[0], /f001/);
  assert.match(facts.failures[0], /contact/);
});

// Issue #16: the old number still appears on the home page and in the contact form note; neither may hide this.
test('a phone changed by many digits inside its own block fails, even when the old number survives elsewhere', () => {
  for (const changedTo of ['(555) 010-0999', '(555) 999-8888']) {
    const dist = editedSite('contact.html', (h) => h.replace('Phone: (555) 010-0142', `Phone: ${changedTo}`));
    const facts = factDiff({ dist, pages, inventory: docs.inventory, storyboard: docs.storyboard });
    assert.deepEqual(facts.changed, [{ fact_id: 'f001', before: '(555) 010-0142', after: changedTo }]);
    assert.match(facts.failures[0], /f001.*contact/);
  }
});

test('a fact removed from the site is listed as missing', () => {
  const dist = editedSite('contact.html', (h) => h.replaceAll('office@maplegrove-hs.example', ''));
  const facts = factDiff({ dist, pages, inventory: docs.inventory, storyboard: docs.storyboard });
  assert.deepEqual(facts.missing, ['f002']);
  assert.deepEqual(facts.changed, []);
  assert.match(facts.failures.join('\n'), /f002/);
});

test('a fact whose block the storyboard dropped is not checked or missing', () => {
  const dist = editedSite('index.html', (h) => h.replace(/<ul data-src="p01-b003"[\s\S]*?<\/ul>/, ''));
  const storyboard = { ...docs.storyboard, dropped: [...docs.storyboard.dropped, { ref: 'p01-b003', reason: 'Old news' }] };
  const facts = factDiff({ dist, pages, inventory: docs.inventory, storyboard });
  assert.equal(facts.checked, 7);
  assert.deepEqual(facts.missing, []);
  const kept = factDiff({ dist, pages, inventory: docs.inventory, storyboard: docs.storyboard });
  assert.deepEqual(kept.missing, ['f008'], 'without the drop, removing the block loses fact f008');
});

// Issue #14: a real Scout emits facts from the footer row ("Copyright 2009 ..."), which no section shows.
test('a fact in a block the new site never shows is not checked, so the gate does not fail on it', () => {
  const inventory = { ...docs.inventory, facts: [...docs.inventory.facts, { fact_id: 'f009', kind: 'date', value: '2009', block_id: 'p01-b091' }] };
  const facts = factDiff({ dist: built, pages, inventory, storyboard: docs.storyboard });
  assert.deepEqual({ checked: facts.checked, missing: facts.missing, failures: facts.failures }, { checked: 8, missing: [], failures: [] });
});

test('facts on a page the storyboard leaves out are not checked', () => {
  const storyboard = {
    ...docs.storyboard,
    pages: docs.storyboard.pages.filter((p) => p.slug !== 'contact'),
    dropped: [...docs.storyboard.dropped, { ref: 'https://maplegrove-hs.example/contact.html', reason: 'Merged into Home' }],
  };
  const facts = factDiff({ dist: built, pages: pages.filter((p) => p.slug !== 'contact'), inventory: docs.inventory, storyboard });
  assert.deepEqual(facts.missing, []);
  assert.equal(facts.checked, 4, 'f001, f002, f003 and f007 sit on the contact page');
});

test('a huge scraped block does not stall the fact diff', () => {
  const junk = `<p>${'a'.repeat(200000)}@b ${'a.'.repeat(100000)}@ ${'1 '.repeat(100000)}x</p>`;
  const dist = editedSite('contact.html', (h) => h.replace('</main>', `${junk}</main>`));
  const start = performance.now();
  const facts = factDiff({ dist, pages, inventory: docs.inventory, storyboard: docs.storyboard });
  assert.ok(performance.now() - start < 3000, `took ${Math.round(performance.now() - start)} ms`);
  assert.deepEqual(facts.missing, []);
});

test('a broken internal link fails the gate', async () => {
  const dist = editedSite('index.html', (h) => h.replace('</main>', '<a href="./calendar.html">Calendar</a></main>'));
  const links = await checkLinks({ dist, pages, fetch: okFetch });
  assert.deepEqual(links.broken, [{ href: './calendar.html', from: 'home' }]);
  assert.equal(links.failures.length, 1);
  assert.match(links.failures[0], /calendar\.html/);
});

test('the CLI exits 3 when a fact on the new site differs from the old one', () => {
  const run = mkdtempSync(join(tmpdir(), 'c-build-facts-cli-'));
  dirs.push(run);
  for (const f of Object.values(FILES)) cpSync(join(SAMPLE, f), join(run, f));
  cpSync(join(SAMPLE, 'a-scout'), join(run, 'a-scout'), { recursive: true });
  // Scout recorded a different number than the block text holds: the built page cannot match it.
  const inventory = read(join(run, FILES.inventory));
  inventory.facts.find((f) => f.fact_id === 'f001').value = '(555) 010-0199';
  writeFileSync(join(run, FILES.inventory), JSON.stringify(inventory));
  const args = [join(import.meta.dirname, '..', 'cli.mjs'), 'build', '--run', run, ...Object.values(FILES).flatMap((f) => ['--in', join(run, f)]), '--out', join(run, '50-handoff.json')];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /fact f001 \(phone\) changed on contact/);
});

test('external links are checked for real but only reported', async () => {
  const server = createServer((req, res) => res.writeHead(req.url === '/ok' ? 200 : 404).end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const external = `http://127.0.0.1:${server.address().port}`;
  try {
    const dist = editedSite('about.html', (h) => h.replace('</main>', `<a href="${external}/ok">Ok</a><a href="${external}/gone">Gone</a></main>`));
    const links = await checkLinks({ dist, pages: pages.filter((p) => p.slug === 'about') });
    assert.deepEqual(links.broken, [{ href: `${external}/gone`, from: 'about' }]);
    assert.deepEqual(links.failures, [], 'an external link never fails the gate');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
