// Tests for the target URL checks (contract rules 2 and 8, plan/web-plan.md T40). No network: DNS is always a fake lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHost, isPublicAddress, parseTarget } from '../urlcheck.mjs';

// ---- rule 2: the address itself (no network) ----

test('parseTarget accepts http and https and returns the normalised address', () => {
  for (const [raw, href] of [
    ['https://maplegrove-hs.example/', 'https://maplegrove-hs.example/'],
    ['http://Example.ORG', 'http://example.org/'],
    ['HTTPS://example.org:8443/a/b?x=1#top', 'https://example.org:8443/a/b?x=1#top'],
    ['http://1.2.3.4/', 'http://1.2.3.4/'],
    ['https://münchen.example/', 'https://xn--mnchen-3ya.example/'],
  ]) {
    const r = parseTarget(raw);
    assert.equal(r.ok, true, raw);
    assert.equal(r.url.href, href, raw);
  }
});

test('parseTarget refuses everything that is not a plain http or https address', () => {
  const bad = [
    'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/', 'ws://example.org/', 'mailto:a@b.example',
    'example.org', '//example.org/', 'http://', 'http:///x', 'https://', 'http:\\\\example.org', 'http://?x', 'http://#x',
    'https://user:pass@example.org/', 'https://user@example.org/', 'https://:pass@example.org/',
    'https://exa mple.org/', 'https://example.org/a b', 'https://example.org/\n', ' https://example.org/', 'https://example.org/ ',
    'https://example.org/\u0000', 'http://1.2.3.4.5/', 'http://exa<mple.org/', '', 'https://' + 'a'.repeat(2050) + '.example/',
  ];
  for (const raw of bad) assert.equal(parseTarget(raw).ok, false, JSON.stringify(raw).slice(0, 60));
  for (const raw of [undefined, null, 5, true, {}, [], ['https://example.org/']]) assert.equal(parseTarget(raw).ok, false, String(raw));
});

test('parseTarget keeps a 2048 character address and refuses 2049', () => {
  const pad = (n) => 'https://example.org/' + 'a'.repeat(n - 'https://example.org/'.length);
  assert.equal(parseTarget(pad(2048)).ok, true);
  assert.equal(parseTarget(pad(2049)).ok, false);
});

// ---- rule 8: the address the name points to ----

test('isPublicAddress refuses loopback, private, link-local, CGNAT and unique-local addresses', () => {
  const refused = [
    '127.0.0.1', '127.255.255.255', '::1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.168.255.255',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '100.127.255.255', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'febf::1', 'fec0::1',
    '0.0.0.0', '0.1.2.3', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250',
    '240.0.0.1', '255.255.255.255', '::', 'ff02::1', '2001:db8::1', '2001::1', '3fff::1',
    // IPv4 inside IPv6: mapped, NAT64 and 6to4 forms of 127.0.0.1, 10.0.0.1 and 169.254.169.254
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::1', '2002:a00:1::', '2002:a9fe:a9fe::1',
  ];
  for (const ip of refused) assert.equal(isPublicAddress(ip), false, ip);
});

test('isPublicAddress accepts ordinary public addresses and the edges next to the private ranges', () => {
  const accepted = [
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.255.255', '169.255.0.1', '192.167.255.255', '192.169.0.1',
    '11.0.0.1', '9.255.255.255', '198.17.255.255', '198.20.0.1', '223.255.255.255',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1',
  ];
  for (const ip of accepted) assert.equal(isPublicAddress(ip), true, ip);
});

test('isPublicAddress treats anything that is not an address as not public', () => {
  for (const x of ['', 'example.org', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', 'fe80::1%eth0', '[::1]', '::g', ':::', '1::2::3', undefined, null, 5]) {
    assert.equal(isPublicAddress(x), false, String(x));
  }
});

const noLookup = () => assert.fail('no DNS lookup is allowed for this host');

test('checkHost refuses literal addresses without any lookup, including the bracketed IPv6 form a URL gives', async () => {
  for (const host of ['127.0.0.1', '[::1]', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '[fc00::1]', '0.0.0.0', '[::ffff:7f00:1]']) {
    assert.deepEqual(await checkHost(host, { lookup: noLookup }), { ok: false, code: 'host_not_public' }, host);
  }
});

test('checkHost refuses a URL written in the tricky IPv4 forms once the URL parser has normalised it', async () => {
  for (const raw of ['http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://0177.0.0.1/', 'http://0/', 'http://[::ffff:127.0.0.1]/', 'http://[0:0:0:0:0:0:0:1]/']) {
    const { url } = parseTarget(raw);
    assert.deepEqual(await checkHost(url.hostname, { lookup: noLookup }), { ok: false, code: 'host_not_public' }, raw);
  }
});

test('checkHost refuses localhost names without a lookup', async () => {
  for (const host of ['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'a.b.localhost.']) {
    assert.deepEqual(await checkHost(host, { lookup: noLookup }), { ok: false, code: 'host_not_public' }, host);
  }
});

test('checkHost refuses a name whose lookup returns a private address, even when a public one comes with it', async () => {
  const returns = (...addresses) => async () => addresses.map((address) => ({ address }));
  assert.deepEqual(await checkHost('evil.example', { lookup: returns('10.0.0.5') }), { ok: false, code: 'host_not_public' });
  assert.deepEqual(await checkHost('evil.example', { lookup: returns('93.184.216.34', '192.168.0.9') }), { ok: false, code: 'host_not_public' });
  assert.deepEqual(await checkHost('evil.example', { lookup: returns('2606:4700:4700::1111', 'fe80::1') }), { ok: false, code: 'host_not_public' });
  assert.deepEqual(await checkHost('evil.example', { lookup: returns('::ffff:169.254.169.254') }), { ok: false, code: 'host_not_public' });
});

test('checkHost accepts a name whose lookup returns only public addresses, in both lookup shapes', async () => {
  assert.deepEqual(await checkHost('maplegrove-hs.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }), { ok: true });
  assert.deepEqual(await checkHost('maplegrove-hs.example', { lookup: async () => ['93.184.216.34', '2606:4700:4700::1111'] }), { ok: true });
  assert.deepEqual(await checkHost('8.8.8.8', { lookup: noLookup }), { ok: true });
  assert.deepEqual(await checkHost('[2606:4700:4700::1111]', { lookup: noLookup }), { ok: true });
});

test('checkHost looks the name up exactly once, as given (lower case, no trailing dot)', async () => {
  const seen = [];
  await checkHost('Example.ORG.', { lookup: async (h) => (seen.push(h), ['93.184.216.34']) });
  assert.deepEqual(seen, ['example.org']);
});

test('checkHost fails closed as bad_url when the name does not resolve, returns nothing or takes too long', async () => {
  assert.deepEqual(await checkHost('nope.example', { lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } }), { ok: false, code: 'bad_url' });
  assert.deepEqual(await checkHost('nope.example', { lookup: async () => [] }), { ok: false, code: 'bad_url' });
  assert.deepEqual(await checkHost('slow.example', { lookup: () => new Promise(() => {}), timeoutMs: 50 }), { ok: false, code: 'bad_url' });
  assert.deepEqual(await checkHost('odd.example', { lookup: async () => [{ address: 'not-an-ip' }] }), { ok: false, code: 'host_not_public' });
});

test('allowLocal is off by default and, when on, lets local hosts through without a lookup', async () => {
  assert.equal((await checkHost('127.0.0.1', { lookup: noLookup })).ok, false);
  assert.equal((await checkHost('127.0.0.1', { lookup: noLookup, allowLocal: false })).ok, false);
  for (const host of ['127.0.0.1', '[::1]', 'localhost', '192.168.1.1']) {
    assert.deepEqual(await checkHost(host, { lookup: noLookup, allowLocal: true }), { ok: true }, host);
  }
});

test('with no lookup given, a literal public address still needs no network and localhost is still refused', async () => {
  assert.deepEqual(await checkHost('8.8.8.8'), { ok: true });
  assert.deepEqual(await checkHost('localhost'), { ok: false, code: 'host_not_public' });
});
