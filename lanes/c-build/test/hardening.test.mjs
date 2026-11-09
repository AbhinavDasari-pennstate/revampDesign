// Issue #18: small fixes, one test each. Nothing here builds a site, so the file runs in seconds.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formFallbacks, indexInventory } from '../builder/content.mjs';
import { ownerReport } from '../handoff/report.mjs';
import { makeRepo } from '../handoff/repo.mjs';
import { checkLinks } from '../qa/links.mjs';
import { serve } from '../qa/serve.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dirs = [];
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `c-build-${name}-`));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test('the QA server answers 400 to a malformed path and keeps serving', async () => {
  const dir = tempDir('serve');
  writeFileSync(join(dir, 'index.html'), '<p>ok</p>');
  const server = await serve(dir);
  try {
    assert.equal((await fetch(`${server.origin}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${server.origin}/index.html`)).status, 200);
  } finally {
    await server.close();
  }
});

test("a form fallback uses its own page's phone and email, and tel: leaves out the extension", () => {
  const inventory = read(join(SAMPLE, '10-inventory.json'));
  // A different office number on the home page, listed first, must not be used for the contact form.
  inventory.facts.unshift({ fact_id: 'f010', kind: 'phone', value: '(555) 010-0999', block_id: 'p01-b004' });
  inventory.facts.find((f) => f.fact_id === 'f001').value = '(555) 010-0142 ext. 12';
  const contact = read(join(SAMPLE, '20-storyboard.json')).pages.find((p) => p.slug === 'contact');
  const [fallback] = formFallbacks(contact, indexInventory(inventory));
  assert.deepEqual(fallback, { id: 'p03-f01', phone: '(555) 010-0142 ext. 12', tel: 'tel:5550100142', email: 'office@maplegrove-hs.example' });
});

test('the site repo commits even when the machine signs commits and has a failing hook', () => {
  const home = tempDir('gitconfig');
  const hooks = join(home, 'hooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(home, 'config'), `[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${hooks.replace(/\\/g, '/')}\n`);
  const site = tempDir('repo');
  writeFileSync(join(site, 'index.html'), '<p>site</p>');
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(home, 'config');
  try {
    makeRepo({ siteDir: site, name: 'Test School', pages: [{ title: 'Home', file: 'index' }] });
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
  assert.equal(execFileSync('git', ['-C', site, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '1');
});

test('a ready report says every required check passed, not every check', () => {
  const qa = {
    axe: { serious: 0, critical: 0 },
    lighthouse: [{ slug: 'home', form_factor: 'mobile', accessibility: 100 }],
    links: { checked: 2, broken: [{ href: 'https://fonts.googleapis.com/css2', from: 'home' }] },
    fact_diff: { checked: 1, changed: [], missing: [] },
  };
  const report = ownerReport({ name: 'Test School', pages: [{ title: 'Home' }], fidelity: { pages_carried: 1, pages_total: 1, dropped: [], flagged: [] }, qa, failures: [] });
  assert.match(report, /Every required check passed/);
  assert.doesNotMatch(report, /Every check passed/);
});

test('the link check never fetches a private address, directly or through a redirect', async () => {
  const dist = tempDir('links');
  writeFileSync(join(dist, 'index.html'), '<a href="http://127.0.0.1:9/admin">a</a><a href="https://public.example/moved">b</a>');
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    return url === 'https://public.example/moved'
      ? { ok: false, status: 302, headers: new Headers({ location: 'http://10.0.0.5/secret' }) }
      : { ok: true, status: 200, headers: new Headers() };
  };
  const lookup = async (host) => [{ address: host === 'public.example' ? '93.184.216.34' : '10.0.0.5' }];
  const links = await checkLinks({ dist, pages: [{ slug: 'home', file: 'index.html' }], fetch, lookup });
  assert.deepEqual(fetched, ['https://public.example/moved'], 'only the public URL is fetched');
  assert.deepEqual(links.broken.map((b) => b.href).sort(), ['http://127.0.0.1:9/admin', 'https://public.example/moved']);
  assert.deepEqual(links.failures, [], 'outside links are still only reported');
});
