// Link check on the built site. Internal links and assets must exist in dist/ (a broken one fails
// the gate); external links are fetched and a dead one is only reported, since the owner may not
// control it. mailto, tel, data and in-page anchors are not checked. An external link, or any
// redirect it leads to, that points at a private network address is never fetched and counts as
// broken, so a link scraped from an old site cannot make the build machine call its own network.
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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

// Addresses a build machine must not be made to call: loopback, private, link-local, carrier-grade
// NAT, benchmarking (198.18.0.0/15), IETF protocol (192.0.0.0/24), multicast and reserved (224 and
// up), unspecified; IPv6 loopback, unique local, link-local, and NAT64 (64:ff9b::/96, which reaches IPv4).
export function privateIp(ip) {
  let v4 = ip.toLowerCase();
  const mapped = v4.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[2], 16), parseInt(mapped[3], 16)];
    v4 = mapped[1] ?? `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (isIP(v4) === 4) {
    const [a, b, c] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  return v4 === '::' || v4 === '::1' || /^f[cd]/.test(v4) || /^fe[89ab]/.test(v4) || v4.startsWith('64:ff9b:');
}

async function privateHost(hostname, lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  return addresses.some(privateIp);
}

// The lookup the socket itself uses. It refuses a private answer at connection time, so a name
// that resolves to a public address for the check above and a private one a moment later (DNS
// rebinding) still never reaches the private address: the connection uses exactly what was checked.
function connectLookup(lookup, allowPrivate) {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true }).then((answers) => {
      const all = answers.map((a) => ({ address: a.address, family: a.family ?? isIP(a.address) }));
      if (!allowPrivate && all.some((a) => privateIp(a.address))) {
        return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }));
      }
      if (options.all) callback(null, all);
      else callback(null, all[0].address, all[0].family);
    }, callback);
  };
}

// One HEAD or GET with node:http(s), connecting only through connectLookup. Fetch-like answer.
function request(url, { method, signal, lookup, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(target, { method, signal, lookup: connectLookup(lookup, allowPrivate), headers: { 'user-agent': 'redesign-agent link check' } }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: { get: (name) => res.headers[name.toLowerCase()] ?? null } });
    });
    req.on('error', reject);
    req.end();
  });
}

// HEAD first; some servers refuse HEAD, so those get one GET. Redirects are followed by hand so
// every hop's address is checked before it is fetched, and again when it is connected to.
async function reachable(url, { fetch, lookup, allowPrivate }) {
  try {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowPrivate && (await privateHost(new URL(target).hostname, lookup))) return false;
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const ask = (method) => (fetch ? fetch(target, { method, redirect: 'manual', signal }) : request(target, { method, signal, lookup, allowPrivate }));
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

// fetch is for tests that stub the network; without it requests go through request() above. allowPrivate is
// for tests that serve "external" links from 127.0.0.1; real builds leave it off.
export async function checkLinks({ dist, pages, fetch, lookup = dnsLookup, allowPrivate = false }) {
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
