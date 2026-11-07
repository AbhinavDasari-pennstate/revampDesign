// Breadth-first crawl of one site with Playwright Chromium. robots.txt is read with plain fetch.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { extractBlocks } from './blocks.mjs';
import { capture } from './capture.mjs';
import { readBrand } from './brand.mjs';

const USER_AGENT = 'RevampScout/1.0 (+https://github.com/AbhinavDasari-pennstate/revampDesign)';
export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE = { width: 390, height: 844 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One page per URL: no hash, no trailing index.html, no trailing slash (root stays "/").
export function normalise(href) {
  const u = new URL(href);
  u.hash = '';
  u.pathname = u.pathname.replace(/(^|\/)index\.html$/, '$1');
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/$/, '');
  return u.href;
}

// The first page may move from example.org to www.example.org or back, and nowhere else.
export const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

// RFC 9309 rule match: "*" is any run of characters, a final "$" anchors the end, otherwise a prefix.
// A two-pointer glob, not a RegExp, so a hostile robots.txt cannot cause catastrophic backtracking.
function robotsMatch(rule, path) {
  const pat = rule.endsWith('$') ? rule.slice(0, -1) : `${rule}*`;
  let p = 0;
  let i = 0;
  let star = -1;
  let mark = 0;
  while (i < path.length) {
    if (pat[p] === '*') {
      star = p++;
      mark = i;
    } else if (p < pat.length && pat[p] === path[i]) {
      p++;
      i++;
    } else if (star >= 0) {
      p = star + 1;
      i = ++mark;
    } else return false;
  }
  while (pat[p] === '*') p++;
  return p === pat.length;
}

// Disallow rules under "User-agent: *" only.
async function disallowed(origin) {
  const res = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT } }).catch(() => null);
  if (!res?.ok) return [];
  const prefixes = [];
  let star = false;
  let inAgentLines = false;
  for (const line of (await res.text()).split(/\r?\n/)) {
    const [key, ...rest] = line.split('#')[0].split(':');
    const field = key.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group (RFC 9309).
      star = (inAgentLines && star) || value === '*';
      inAgentLines = true;
    } else {
      inAgentLines = false;
      if (field === 'disallow' && star && value) prefixes.push(value);
    }
  }
  return prefixes;
}

export async function crawl({ startUrl, maxPages, runDir, delayMs = 1000 }) {
  let blocked = await disallowed(new URL(startUrl).origin);
  let host = new URL(startUrl).host;
  const start = normalise(startUrl);
  const queue = [{ url: start, depth: 0 }];
  const seen = new Set([start]);
  const pages = [];
  const failures = [];
  let brand = { logo_path: null, colors: [], fonts: [] };
  mkdirSync(join(runDir, 'a-scout', 'screens'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ userAgent: USER_AGENT })).newPage();
    let navigations = 0;
    // ponytail: 4 navigations per allowed page bounds a site full of dead links; raise it if real sites stop short of max_pages.
    while (queue.length && pages.length < maxPages && navigations < maxPages * 4) {
      const { url, depth } = queue.shift();
      const { pathname, search } = new URL(url);
      if (blocked.some((rule) => robotsMatch(rule, pathname + search))) continue;
      if (navigations) await sleep(delayMs);
      navigations++;
      try {
        await page.setViewportSize(DESKTOP);
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        if (response.status() >= 400) {
          failures.push({ url, reason: `HTTP ${response.status()}` });
          continue;
        }
        const finalUrl = normalise(page.url());
        if (pages.some((p) => p.url === finalUrl)) continue;
        const finalHost = new URL(finalUrl).host;
        if (finalHost !== host) {
          if (pages.length || !sameSite(host, finalHost)) {
            failures.push({ url, reason: 'redirected off host' });
            continue;
          }
          host = finalHost;
          blocked = await disallowed(new URL(finalUrl).origin);
        }
        const id = `p${String(pages.length + 1).padStart(2, '0')}`;
        const screenshots = { desktop: `a-scout/screens/${id}-desktop.png`, mobile: `a-scout/screens/${id}-mobile.png` };
        const hrefs = await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.href));
        const blocks = await extractBlocks(page, id);
        const { images, links, forms } = await capture(page, id, runDir, host);
        if (!pages.length) brand = await readBrand(page, images);
        await page.screenshot({ path: join(runDir, screenshots.desktop), fullPage: true });
        await page.setViewportSize(MOBILE);
        await page.screenshot({ path: join(runDir, screenshots.mobile), fullPage: true });
        pages.push({ page_id: id, url: finalUrl, title: await page.title(), status_code: response.status(), depth, screenshots, blocks, images, links, forms });
        for (const href of hrefs) {
          if (!URL.canParse(href)) continue;
          const next = normalise(href);
          if (new URL(next).host === host && !seen.has(next)) {
            seen.add(next);
            queue.push({ url: next, depth: depth + 1 });
          }
        }
      } catch (e) {
        failures.push({ url, reason: e.message.split('\n')[0] });
      }
    }
  } finally {
    await browser.close();
  }
  return { pages, failures, brand };
}
