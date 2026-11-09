// T23: on the sample, build exits 0 and hands over a valid 50-handoff.json, the site as a git repo
// with one commit and a README, screenshots, and a plain-language report of what was left out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fidelity } from '../handoff/fidelity.mjs';
import { schemaErrors } from '../lib/contracts.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const FILES = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const PATH_KEYS = new Set(['desktop', 'mobile', 'path', 'repo_path', 'preview_local', 'report_path']);

let run;
let result;
let handoff;

before(() => {
  run = mkdtempSync(join(tmpdir(), 'c-build-handoff-'));
  for (const f of Object.values(FILES)) cpSync(join(SAMPLE, f), join(run, f));
  cpSync(join(SAMPLE, 'a-scout'), join(run, 'a-scout'), { recursive: true });
  // Issue #14: a real Scout also emits the footer's copyright year, which no section shows.
  const inventory = read(join(run, FILES.inventory));
  inventory.facts.push({ fact_id: 'f009', kind: 'date', value: '2009', block_id: 'p01-b091' });
  writeFileSync(join(run, FILES.inventory), JSON.stringify(inventory));
  const args = [join(import.meta.dirname, '..', 'cli.mjs'), 'build', '--run', run, ...Object.values(FILES).flatMap((f) => ['--in', join(run, f)]), '--out', join(run, '50-handoff.json')];
  result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  handoff = existsSync(join(run, '50-handoff.json')) ? read(join(run, '50-handoff.json')) : null;
});
after(() => rmSync(run, { recursive: true, force: true }));

// Every relative path value under a path key, anywhere in the document.
function paths(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => paths(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (PATH_KEYS.has(k) && typeof v === 'string') out.push(v);
      else paths(v, out);
    }
  }
  return out;
}

test('build exits 0 and writes a valid handoff that says pass', () => {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(schemaErrors(handoff), []);
  assert.equal(handoff.status, 'pass');
  assert.equal(handoff.qa.gates_passed, true);
  assert.equal(handoff.run_id, 'sample-0001');
  assert.equal(handoff.cost_usd, 0);
});

test('every path in the handoff exists in the run folder, and every page slug is a storyboard page', () => {
  for (const rel of paths(handoff)) {
    assert.ok(!rel.includes('\\') && !rel.startsWith('/'), `${rel} is relative with forward slashes`);
    assert.ok(existsSync(join(run, rel)), `${rel} exists`);
  }
  const slugs = read(join(run, FILES.storyboard)).pages.map((p) => p.slug);
  assert.deepEqual(handoff.site.pages.map((p) => p.slug), slugs);
});

test('each page has desktop and mobile screenshots as PNG files', () => {
  for (const { screenshots } of handoff.site.pages) {
    for (const rel of [screenshots.desktop, screenshots.mobile]) {
      assert.deepEqual([...readFileSync(join(run, rel)).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${rel} is a PNG`);
    }
  }
});

test('the site is a git repo with one commit, a README, and nothing left uncommitted', () => {
  const git = (...a) => execFileSync('git', ['-C', join(run, handoff.site.repo_path), ...a], { encoding: 'utf8' }).trim();
  assert.equal(git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(git('ls-files', 'README.md'), 'README.md');
  assert.ok(git('ls-files', 'dist/index.html'), 'the built pages are committed, so the site can be uploaded as is');
  assert.equal(git('status', '--porcelain'), '');
  assert.match(readFileSync(join(run, handoff.site.repo_path, 'README.md'), 'utf8'), /Maple Grove High School/);
});

test('fidelity counts match the inventory', () => {
  assert.equal(handoff.fidelity.pages_total, 4, '3 pages crawled plus 1 that failed');
  assert.equal(handoff.fidelity.pages_carried, 3);
  assert.deepEqual(handoff.fidelity.dropped.map((d) => d.ref), ['https://maplegrove-hs.example/calendar.html', 'f009']);
  assert.match(handoff.fidelity.dropped[1].reason, /date "2009"/, 'the footer fact is reported, not hidden');
  assert.deepEqual(handoff.fidelity.flagged.map((f) => f.ref), ['p03-f01']);
});

test('the report lists every dropped and flagged item in plain language', () => {
  const report = readFileSync(join(run, handoff.report_path), 'utf8');
  for (const item of [...handoff.fidelity.dropped, ...handoff.fidelity.flagged]) {
    assert.ok(report.includes(item.ref), `report names ${item.ref}`);
    assert.ok(report.includes(item.reason), `report gives the reason for ${item.ref}`);
  }
  assert.match(report.split('\n').slice(0, 5).join('\n'), /ready to publish/i, 'the first lines say whether the site is ready');
  assert.doesNotMatch(report, /[\u2013\u2014]/);
});

test('fidelity lists what the new site leaves out: unused pages, outside links, lost images, plain forms', () => {
  const inventory = read(join(SAMPLE, FILES.inventory));
  const storyboard = read(join(SAMPLE, FILES.storyboard));
  inventory.pages[0].links.push({ href: 'https://district.example/', text: 'District', internal: false });
  inventory.pages[1].forms.push({ form_id: 'p02-f01', action: 'https://search.example/', method: 'get', needs_backend: false, fields: [] });
  inventory.pages[0].images[0].local_path = null;
  storyboard.pages = storyboard.pages.filter((p) => p.slug !== 'contact');
  const f = fidelity({ inventory, storyboard, runDir: SAMPLE });
  assert.equal(f.pages_carried, 2);
  assert.equal(f.pages_total, 4);
  const refs = f.dropped.map((d) => d.ref);
  for (const ref of ['https://maplegrove-hs.example/contact.html', 'https://district.example/', 'p02-f01', 'p01-i01']) assert.ok(refs.includes(ref), `${ref} dropped`);
  assert.ok(f.dropped.every((d) => d.reason.length > 0));
  assert.deepEqual(f.flagged, [], 'the contact form is gone with its page, so nothing is flagged');
});
