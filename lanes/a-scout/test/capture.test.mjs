import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crawl } from '../scout/crawl.mjs';
import { serve } from './serve.mjs';

const html = (body) => ({ body: `<html><head><title>t</title></head><body>${body}</body></html>` });
const crawlSite = (origin, maxPages = 40) => {
  const runDir = mkdtempSync(join(tmpdir(), 'capture-'));
  return crawl({ startUrl: `${origin}/`, maxPages, runDir, delayMs: 0 }).then((r) => ({ ...r, runDir }));
};
const withSite = async (extra, fn) => {
  const s = await serve(extra);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
};

describe('scout capture', () => {
  let site, result;
  before(async () => {
    site = await serve();
    result = await crawlSite(site.origin);
  });
  after(() => site.close());

  test('p01 has the crest image with an element screenshot', () => {
    const [img] = result.pages[0].images;
    assert.deepEqual(img, {
      image_id: 'p01-i01',
      src_url: `${site.origin}/crest.svg`,
      local_path: 'a-scout/images/p01-i01.png',
      alt: 'Maple Grove High School crest',
      width: 64,
      height: 64,
      origin: 'site',
    });
    assert.ok(existsSync(join(result.runDir, img.local_path)));
  });

  test('every page lists the four nav links as written, all internal', () => {
    for (const p of result.pages) {
      assert.deepEqual(p.links.map((l) => [l.href, l.text, l.internal]), [
        ['index.html', 'Home', true], ['about.html', 'About Us', true], ['contact.html', 'Contact', true], ['calendar.html', 'Calendar', true],
      ]);
    }
  });

  test('p03 has the contact form with three labelled fields', () => {
    assert.deepEqual(result.pages[0].forms, []);
    assert.deepEqual(result.pages[2].forms, [{
      form_id: 'p03-f01',
      action: '/cgi-bin/contact.pl',
      method: 'post',
      needs_backend: true,
      fields: [
        { name: 'name', type: 'text', label: 'Your name', required: false },
        { name: 'email', type: 'text', label: 'Your email', required: false },
        { name: 'message', type: 'textarea', label: 'Message', required: false },
      ],
    }]);
  });
});

test('an external link is recorded as not internal and its host is never navigated', async () => {
  await withSite({ '/': html('<a href="https://example.org/">ext</a><a href="/contact.html">c</a>') }, async (s) => {
    const { pages, failures } = await crawlSite(s.origin, 2);
    assert.deepEqual(pages[0].links, [
      { href: 'https://example.org/', text: 'ext', internal: false },
      { href: '/contact.html', text: 'c', internal: true },
    ]);
    assert.deepEqual(pages.map((p) => p.url), [`${s.origin}/`, `${s.origin}/contact.html`]);
    assert.deepEqual(failures, []);
  });
});

test('image ids follow DOM order and origin tells site from third party', async () => {
  await withSite({}, (other) => withSite({
    '/': html(`<img src="/crest.svg" alt="a"><img src="${other.origin}/crest.svg" alt="b"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="c">`),
  }, async (s) => {
    const [page] = (await crawlSite(s.origin, 1)).pages;
    assert.deepEqual(page.images.map((i) => [i.image_id, i.alt, i.origin]), [['p01-i01', 'a', 'site'], ['p01-i02', 'b', 'third_party']]);
  }));
});

test('an image that cannot be screenshotted gets a null local_path', async () => {
  await withSite({ '/': html('<img src="/crest.svg" alt="hidden" style="display:none">') }, async (s) => {
    const [page] = (await crawlSite(s.origin, 1)).pages;
    assert.equal(page.images[0].local_path, null);
  });
});
