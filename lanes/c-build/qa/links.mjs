// Link check on the built site. Internal links and assets must exist in dist/ (a broken one fails
// the gate); external links are fetched and a dead one is only reported, since the owner may not
// control it. mailto, tel, data and in-page anchors are not checked.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { linkTargets } from './html.mjs';

const NOT_CHECKED = /^(#|mailto:|tel:|data:|javascript:)/i;
const TIMEOUT_MS = 10000;

function inDist(dist, file, href) {
  let path = decodeURIComponent(new URL(href, `http://site/${file}`).pathname).replace(/^\/+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const full = join(dist, path);
  return existsSync(full) && statSync(full).isFile();
}

// HEAD first; some servers refuse HEAD, so those get one GET.
async function reachable(url, fetch) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ([403, 405, 501].includes(r.status)) r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function checkLinks({ dist, pages, fetch = globalThis.fetch }) {
  const seen = new Set();
  const internal = [];
  const external = [];
  for (const { slug, file } of pages) {
    for (const href of linkTargets(readFileSync(join(dist, file), 'utf8'))) {
      if (NOT_CHECKED.test(href) || seen.has(`${slug} ${href}`)) continue;
      seen.add(`${slug} ${href}`);
      const url = href.startsWith('//') ? `https:${href}` : href;
      if (/^https?:\/\//i.test(url)) external.push({ href, from: slug, url });
      else internal.push({ href, from: slug, ok: inDist(dist, file, href) });
    }
  }
  const urls = [...new Set(external.map((e) => e.url))];
  const alive = new Map(await Promise.all(urls.map(async (u) => [u, await reachable(u, fetch)])));

  const brokenInternal = internal.filter((l) => !l.ok);
  const brokenExternal = external.filter((l) => !alive.get(l.url));
  return {
    checked: internal.length + external.length,
    broken: [...brokenInternal, ...brokenExternal].map(({ href, from }) => ({ href, from })),
    failures: brokenInternal.map((l) => `link ${l.href} on ${l.from} goes nowhere: the new site has no such file`),
  };
}
