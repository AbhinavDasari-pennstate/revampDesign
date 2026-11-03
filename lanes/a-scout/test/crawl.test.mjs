import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemaErrors } from '../../../contracts/validate.mjs';
import { crawl } from '../scout/crawl.mjs';
import { serve } from './serve.mjs';

const CLI = join(import.meta.dirname, '../cli.mjs');
const FIXTURES = join(import.meta.dirname, '../../../contracts/fixtures/sample');
const fixture = JSON.parse(readFileSync(join(FIXTURES, '10-inventory.json'), 'utf8'));
const fixtureRun = JSON.parse(readFileSync(join(FIXTURES, '00-run.json'), 'utf8'));
const FIXTURE_ORIGIN = 'https://maplegrove-hs.example';

const newRun = (origin, limits = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'scout-'));
  const run = { ...fixtureRun, source_url: `${origin}/`, limits: { ...fixtureRun.limits, ...limits } };
  writeFileSync(join(dir, '00-run.json'), JSON.stringify(run));
  return dir;
};
const runCli = (dir) =>
  new Promise((resolve) =>
    execFile(process.execPath, [CLI, 'scout', '--run', dir, '--in', join(dir, '00-run.json'), '--out', join(dir, '10-inventory.json')],
      (err) => resolve(err ? err.code : 0)));
const crawlSite = (origin, maxPages = 40) => crawl({ startUrl: `${origin}/`, maxPages, runDir: newRun(origin), delayMs: 0 });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

let site, dir, code, out;
describe('scout crawl', () => {
before(async () => {
  site = await serve();
  dir = newRun(site.origin);
  code = await runCli(dir);
  out = readJson(join(dir, '10-inventory.json'));
});
after(() => site.close());

test('(a) pages are index, about, contact as p01 to p03 in BFS order', () => {
  assert.equal(code, 0);
  assert.deepEqual(out.pages.map((p) => [p.page_id, p.depth, p.status_code]), [['p01', 0, 200], ['p02', 1, 200], ['p03', 1, 200]]);
  assert.deepEqual(out.pages.map((p) => p.title), fixture.pages.map((p) => p.title));
  assert.deepEqual(out.pages.map((p) => p.url), fixture.pages.map((p) => p.url.replace(FIXTURE_ORIGIN, site.origin).replace(/index\.html$/, '')));
});

test('(b) calendar.html is a failure with reason HTTP 404', () => {
  assert.deepEqual(out.failures, [{ url: `${site.origin}/calendar.html`, reason: 'HTTP 404' }]);
});

test('(c) block kind, level and text match the fixture, nav and footer excluded', () => {
  const expected = fixture.pages.map((p) =>
    p.blocks.filter((b) => b.kind !== 'nav' && b.kind !== 'footer').flatMap((b) => {
      // The fixture hand-merges the bold "News and Announcements" paragraph into the list p01-b003; the HTML has two blocks.
      if (b.block_id !== 'p01-b003') return [[b.kind, b.level, b.text]];
      const [title, ...items] = b.text.split('\n');
      return [['paragraph', null, title], ['list', null, items.join('\n')]];
    }));
  const actual = out.pages.map((p) => p.blocks.filter((b) => b.kind !== 'nav' && b.kind !== 'footer').map((b) => [b.kind, b.level, b.text]));
  assert.deepEqual(actual, expected);
});

test('(d) robots.txt Disallow is honoured: about.html is never requested', async () => {
  const s = await serve({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /about\n' } });
  try {
    const { pages } = await crawlSite(s.origin);
    assert.ok(!s.log.includes('/about.html'));
    assert.deepEqual(pages.map((p) => p.url), [`${s.origin}/`, `${s.origin}/contact.html`]);
  } finally {
    await s.close();
  }
});

test('(e) two crawls give identical block ids', async () => {
  const ids = (r) => r.pages.map((p) => p.blocks.map((b) => b.block_id));
  assert.deepEqual(ids(await crawlSite(site.origin)), ids(out));
});

test('(f) output is schema valid and every path uses forward slashes', () => {
  assert.deepEqual(schemaErrors(out), []);
  for (const p of out.pages) {
    for (const rel of Object.values(p.screenshots)) {
      assert.ok(!rel.includes('\\'), rel);
      assert.ok(existsSync(join(dir, rel)), rel);
    }
  }
});

test('(g) limits.max_pages 2 gives 2 pages', async () => {
  assert.equal((await crawlSite(site.origin, 2)).pages.length, 2);
});

test('(h) a 503 home page exits 3 with no inventory and the reason in failure.json', async () => {
  const s = await serve({ '/': { status: 503, body: 'down' } });
  try {
    const d = newRun(s.origin);
    assert.equal(await runCli(d), 3);
    assert.ok(!existsSync(join(d, '10-inventory.json')));
    assert.equal(readJson(join(d, 'a-scout', 'failure.json')).failures[0].reason, 'HTTP 503');
  } finally {
    await s.close();
  }
});

test('(i) an input that fails its schema exits 2', async () => {
  const d = newRun(site.origin);
  writeFileSync(join(d, '00-run.json'), JSON.stringify({ ...fixtureRun, tier: 'Z' }));
  assert.equal(await runCli(d), 2);
});
const html = (body) => ({ body: `<html><head><title>t</title></head><body>${body}</body></html>` });
const withSite = async (extra, fn) => {
  const s = await serve(extra);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
};

test('(j) a same-host link that redirects to another host is a failure, not a page', async () => {
  await withSite({}, (other) => withSite({
    '/': html('<p>home</p><a href="/out">out</a>'),
    '/out': { status: 302, headers: { location: `${other.origin}/` } },
  }, async (s) => {
    const { pages, failures } = await crawlSite(s.origin);
    assert.deepEqual(pages.map((p) => p.url), [`${s.origin}/`]);
    assert.deepEqual(failures, [{ url: `${s.origin}/out`, reason: 'redirected off host' }]);
  }));
});

test('(k) an unparsable href is skipped and the other links are still queued', async () => {
  await withSite({ '/': html('<p>home</p><a href="http://">bad</a><a href="/contact.html">c</a>') }, async (s) => {
    const { pages, failures } = await crawlSite(s.origin, 2);
    assert.deepEqual(pages.map((p) => p.url), [`${s.origin}/`, `${s.origin}/contact.html`]);
    assert.deepEqual(failures, []);
  });
});

test('(l) only a whole index.html path segment is stripped', async () => {
  await withSite({ '/': html('<a href="/siteindex.html">s</a>'), '/siteindex.html': html('<p>s</p>') }, async (s) => {
    const { pages } = await crawlSite(s.origin);
    assert.deepEqual(pages.map((p) => p.url), [`${s.origin}/`, `${s.origin}/siteindex.html`]);
  });
});

test('(m) consecutive User-agent lines form one robots group', async () => {
  const robots = { type: 'text/plain', body: 'User-agent: *\nUser-agent: Googlebot\nDisallow: /contact\n' };
  await withSite({ '/robots.txt': robots }, async (s) => {
    await crawlSite(s.origin);
    assert.ok(!s.log.includes('/contact.html'));
  });
});

test('(n) nav, data table, blockquote, address and footer become their own blocks', async () => {
  const body = '<nav><a href="/">Home</a> <a href="/x">Other</a></nav><table><tr><td>Mon</td><td>8 AM</td></tr></table>'
    + '<blockquote>Be kind.</blockquote><address>1 Main St</address><footer>Copyright</footer>';
  await withSite({ '/': html(body) }, async (s) => {
    const [page] = (await crawlSite(s.origin, 1)).pages;
    assert.deepEqual(page.blocks.map((b) => [b.kind, b.text]), [
      ['nav', 'Home Other'], ['table', 'Mon | 8 AM'], ['quote', 'Be kind.'], ['contact', '1 Main St'], ['footer', 'Copyright'],
    ]);
  });
});

test('(o) a div or span with only inline content is a block, with legal and contact rules applied', async () => {
  await withSite({ '/': html('<div>Founded in 1962.</div><div><span>Call (555) 010-0142</span></div>') }, async (s) => {
    const [page] = (await crawlSite(s.origin, 1)).pages;
    assert.deepEqual(page.blocks.map((b) => [b.kind, b.text]), [['paragraph', 'Founded in 1962.'], ['contact', 'Call (555) 010-0142']]);
  });
});
});
