// Link check on the built site. Internal links and assets must exist in dist/ (a broken one fails
// the gate); external links are fetched and a dead one is only reported, since the owner may not
// control it. mailto, tel, data and in-page anchors are not checked. An external link, or any
// redirect it leads to, that points at a private network address is never fetched and counts as
// broken, so a link scraped from an old site cannot make the build machine call its own network.
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { linkTargets } from './html.mjs';

const NOT_CHECKED = /^(#|mailto:|tel:|data:|javascript:)/i;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

function inDist(dist, file, href) {
  let path;
  try {
    path = decodeURIComponent(new URL(href, `http://site/${file}`).pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const full = join(dist, path);
  return existsSync(full) && statSync(full).isFile();
}

// Loopback, private, link-local, carrier-grade NAT and unspecified addresses, IPv4 and IPv6.
export function privateIp(ip) {
  let v4 = ip.toLowerCase();
  const mapped = v4.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[2], 16), parseInt(mapped[3], 16)];
    v4 = mapped[1] ?? `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return v4 === '::' || v4 === '::1' || /^f[cd]/.test(v4) || /^fe[89ab]/.test(v4);
}

async function privateHost(hostname, lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  return addresses.some(privateIp);
}

// HEAD first; some servers refuse HEAD, so those get one GET. Redirects are followed by hand so
// every hop's address is checked before it is fetched.
async function reachable(url, { fetch, lookup, allowPrivate }) {
  try {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowPrivate && (await privateHost(new URL(target).hostname, lookup))) return false;
      const ask = (method) => fetch(target, { method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      let r = await ask('HEAD');
      if ([403, 405, 501].includes(r.status)) r = await ask('GET');
      const next = r.status >= 300 && r.status < 400 ? r.headers?.get('location') : null;
      if (!next) return r.ok;
      target = new URL(next, target).href;
    }
    return false;
  } catch {
    return false;
  }
}

// allowPrivate is for tests that serve "external" links from 127.0.0.1; real builds leave it off.
export async function checkLinks({ dist, pages, fetch = globalThis.fetch, lookup = dnsLookup, allowPrivate = false }) {
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
  const alive = new Map(await Promise.all(urls.map(async (u) => [u, await reachable(u, { fetch, lookup, allowPrivate })])));

  const brokenInternal = internal.filter((l) => !l.ok);
  const brokenExternal = external.filter((l) => !alive.get(l.url));
  return {
    checked: internal.length + external.length,
    broken: [...brokenInternal, ...brokenExternal].map(({ href, from }) => ({ href, from })),
    failures: brokenInternal.map((l) => `link ${l.href} on ${l.from} goes nowhere: the new site has no such file`),
  };
}
