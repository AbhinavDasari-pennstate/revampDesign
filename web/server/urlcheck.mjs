// Target address checks for POST /api/jobs: contract rule 2 (parseTarget, no network) and rule 8 (checkHost, one DNS lookup).
// Node stdlib only. This is the first line of defence: Scout resolves the name again when it fetches, so a hostile DNS server that answers
// differently the second time is not stopped here (see web/server/CLAUDE.md). Stricter wins on every doubt: a name that does not resolve is refused.
import { promises as dns } from 'node:dns';

const MAX_URL = 2048;
// The same address test as start-request.v1 (scheme, then a host character), plus no whitespace or control character anywhere.
const LOOKS_LIKE_URL = /^https?:\/\/[^\s/\\?#]/i;
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

// Rule 2. Returns { ok: true, url } with a parsed URL object, or { ok: false }. The caller passes url.href on, so the host that was
// checked is the host that gets fetched.
export function parseTarget(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL) return { ok: false };
  if (FORBIDDEN_CHARS.test(raw) || !LOOKS_LIKE_URL.test(raw)) return { ok: false };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.hostname === '' || url.username !== '' || url.password !== '') return { ok: false };
  return { ok: true, url };
}

// ---- addresses ----

function parseIPv4(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255) return null;
    octets.push(Number(p));
  }
  return octets;
}

// Eight 16-bit groups, or null. Accepts "::" and a dotted IPv4 tail (::ffff:1.2.3.4); refuses zone ids and brackets.
function parseIPv6(text) {
  if (typeof text !== 'string' || !text.includes(':')) return null;
  let tail = [];
  let body = text;
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    body = text.slice(0, lastColon + 1) + '0:0'; // placeholder groups, replaced below
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const group = (s) => (s === '' ? [] : s.split(':'));
  const head = group(halves[0]);
  const rest = halves.length === 2 ? group(halves[1]) : [];
  const all = halves.length === 2 ? [...head, ...rest] : head;
  if (all.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  let groups;
  if (halves.length === 2) {
    const fill = 8 - all.length;
    if (fill < 1) return null; // "::" must stand for at least one group
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const values = groups.map((g) => parseInt(g, 16));
  if (tail.length) values.splice(6, 2, ...tail);
  return values;
}

function publicIPv4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast and reserved (incl. broadcast)
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol block, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // old 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

const v4Of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

function publicIPv6(g) {
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicIPv4(v4Of(g[6], g[7])); // ::ffff:a.b.c.d (mapped)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return publicIPv4(v4Of(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return publicIPv4(v4Of(g[1], g[2])); // 6to4: the IPv4 address sits in bits 16 to 47
  if (g[0] < 0x2000 || g[0] > 0x3fff) return false; // only global unicast 2000::/3 can be public: refuses ::, ::1, fc00::/7, fe80::/10, ff00::/8
  if (g[0] === 0x2001 && (g[1] < 0x0200 || g[1] === 0x0db8)) return false; // 2001::/23 (Teredo and protocol blocks), 2001:db8::/32 documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

// True only for a well-formed IPv4 or IPv6 address that is globally routable. Anything else (names, zone ids, garbage) is not public.
export function isPublicAddress(text) {
  const v4 = parseIPv4(text);
  if (v4) return publicIPv4(v4);
  const v6 = parseIPv6(text);
  return v6 ? publicIPv6(v6) : false;
}

// ---- rule 8 ----

const defaultLookup = (name) => dns.lookup(name, { all: true, verbatim: true });

// hostname is URL.hostname (IPv6 arrives in brackets). Returns { ok: true } or { ok: false, code } with code host_not_public or bad_url.
// allowLocal is the --allow-local switch for running on the local sample site: it skips the whole check.
export async function checkHost(hostname, { lookup = defaultLookup, allowLocal = false, timeoutMs = 5000 } = {}) {
  if (allowLocal) return { ok: true };
  const host = String(hostname).toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, code: 'host_not_public' };
  if (host.includes(':') || parseIPv4(host)) return isPublicAddress(host) ? { ok: true } : { ok: false, code: 'host_not_public' };

  let timer;
  let found;
  try {
    found = await Promise.race([
      Promise.resolve(lookup(host)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lookup timed out')), timeoutMs); }),
    ]);
  } catch {
    return { ok: false, code: 'bad_url' }; // does not resolve: most likely a typo, and never let an unresolvable name through
  } finally {
    clearTimeout(timer);
  }
  const addresses = (found ?? []).map((a) => (typeof a === 'string' ? a : a?.address));
  if (addresses.length === 0) return { ok: false, code: 'bad_url' };
  return addresses.every(isPublicAddress) ? { ok: true } : { ok: false, code: 'host_not_public' };
}
