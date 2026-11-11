// Tests for invite codes (plan/web-plan.md T47): how the server uses the invite store (rules 5 and 6), the store itself (invites.mjs) and the admin tool (admin.mjs).
// Never a network call and never a paid model: the orchestrator is the fake one from test/fake-orchestrator.mjs.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALPHABET, createInviteStore, newCode } from '../invites.mjs';
import { FAKE, argvOf, assertError, assertJob, cleanup, finished, getJob, jobDir, oneUse, post, request, startApp, tempDir, waitFor } from './harness.mjs';

afterEach(cleanup);

// ---- how the server uses the invite store ----

test('invite_code must be a string: a number, object, array, boolean, null, empty or missing code is invite_invalid and never reaches the store', async () => {
  const seen = [];
  const greedy = { check: (code) => (seen.push(code), { label: 'any', usedToday: false }), recordUse() {} }; // a store that accepts whatever it is given
  const { base } = await startApp({ invites: greedy });
  const { invite_code, ...noCode } = request();
  const bodies = [noCode, request({ invite_code: 12345 }), request({ invite_code: {} }), request({ invite_code: { code: 'K7M2PQ9XWD4R' } }), request({ invite_code: ['K7M2PQ9XWD4R'] }), request({ invite_code: true }), request({ invite_code: null }), request({ invite_code: '' })];
  for (const body of bodies) assertError(await post(base, body), 'invite_invalid', 403);
  assert.deepEqual(seen, [], 'the store only ever gets a non empty string');
  const ok = await post(base, request());
  assert.equal(ok.status, 202);
  assertJob(ok.json);
  assert.ok(seen.length > 0 && seen.every((c) => c === 'K7M2PQ9XWD4R'));
});

test('the invite is used up only after the job was accepted: a disk error while saving the job leaves the code unused', async () => {
  const invites = oneUse();
  const { base, dataDir } = await startApp({ invites });
  rmSync(join(dataDir, 'jobs'), { recursive: true, force: true });
  writeFileSync(join(dataDir, 'jobs'), 'a file where the jobs folder should be'); // no job folder can be made under a file
  const failed = await post(base, request({ invite_code: 'ONCE' }));
  assert.equal(failed.status, 500);
  assert.deepEqual([...invites.used], [], 'a failed start does not use up the code');

  rmSync(join(dataDir, 'jobs'));
  mkdirSync(join(dataDir, 'jobs'));
  const retry = await post(base, request({ invite_code: 'ONCE' }));
  assert.equal(retry.status, 202, 'the tester can try again with the same code');
  assert.deepEqual([...invites.used], ['label-ONCE']);
});

test('if saving the use fails after the job was accepted, the run still goes ahead (202) and the failure is logged', async () => {
  const errors = [];
  const invites = { check: () => ({ label: 'pilot', usedToday: false }), recordUse() { throw new Error('disk full'); } };
  const { base } = await startApp({ invites, log: { log() {}, error: (m) => errors.push(String(m)) } });
  const res = await post(base, request());
  assert.equal(res.status, 202);
  assertJob(res.json);
  assert.equal((await finished(base, res.json.job_id)).status, 'done', 'the job that was accepted is not orphaned');
  assert.ok(errors.some((m) => /pilot/.test(m) && /disk full/.test(m)), `logged: ${errors.join(' | ')}`);
  assert.equal((await getJob(base, res.json.job_id)).status, 200);
});

// ---- the invite store (invites.mjs) and the admin tool (admin.mjs) ----

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const ADMIN = join(serverDir, 'admin.mjs');
const CLEAN_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{12}$/; // no 0 O 1 I L
const realTimingSafeEqual = crypto.timingSafeEqual; // taken before any test replaces it
const at = (iso) => () => new Date(iso);
const quiet = { log() {}, error() {}, warn() {} };

// Runs the admin tool as a program from a folder that is not the repo, so a path written relative to the working folder would show.
function admin(dataDir, ...args) {
  const cwd = tempDir();
  const r = spawnSync(process.execPath, [ADMIN, '--data-dir', dataDir, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, out: r.stdout, err: r.stderr, cwd };
}
const codeOf = (text) => /code for [A-Za-z0-9._-]+: ([A-Z0-9]{12})\b/.exec(text)?.[1];
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

// Replaces one function of node:crypto for the duration of fn only. The named imports of an ES module follow after syncBuiltinESMExports().
function withCrypto(name, impl, fn) {
  const m = mock.method(crypto, name, impl);
  syncBuiltinESMExports();
  try {
    return fn(m.mock);
  } finally {
    m.mock.restore();
    syncBuiltinESMExports();
  }
}

test('invite add prints a code once; invites.json holds only its SHA-256 hash and the label, and no file under the data dir has the code', () => {
  const dir = tempDir();
  const r = admin(dir, 'invite', 'add', 'pilot-1');
  assert.equal(r.code, 0, r.err);
  const code = codeOf(r.out);
  assert.match(code, CLEAN_ALPHABET);
  assert.equal(r.out.split(code).length, 2, 'printed exactly once');
  assert.ok(!r.err.includes(code));
  const text = readFileSync(join(dir, 'invites.json'), 'utf8');
  assert.ok(!text.includes(code), 'the plain code is not in invites.json');
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc).sort(), ['invites', 'salt']);
  assert.match(doc.salt, /^[0-9a-f]{32}$/);
  assert.equal(doc.invites.length, 1);
  assert.deepEqual(Object.keys(doc.invites[0]).sort(), ['created_at', 'hash', 'label', 'last_used_day', 'revoked']);
  assert.equal(doc.invites[0].label, 'pilot-1');
  assert.equal(doc.invites[0].hash, createHash('sha256').update(Buffer.from(doc.salt, 'hex')).update(code).digest('hex'), 'a salted SHA-256');
  for (const file of filesUnder(dir)) assert.ok(!readFileSync(file, 'utf8').includes(code), file);
  const listed = admin(dir, 'invite', 'list');
  assert.equal(listed.code, 0, listed.err);
  assert.ok(!listed.out.includes(code) && !listed.out.includes(doc.invites[0].hash) && listed.out.includes('pilot-1'));
});

test('codes are 12 characters from an alphabet without 0 O 1 I L, drawn from crypto.randomBytes without modulo bias, and never repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const code = newCode();
    assert.match(code, CLEAN_ALPHABET);
    seen.add(code);
  }
  assert.equal(seen.size, 500);
  assert.equal(ALPHABET.length, 31);
  // all zero bytes give the first letter, so the letters really come from randomBytes
  assert.equal(withCrypto('randomBytes', (n) => Buffer.alloc(n, 0), () => newCode()), 'A'.repeat(12));
  // bytes of 248 and above are thrown away (248 is 8 times 31), so no letter is likelier than another
  let batches = 0;
  assert.equal(withCrypto('randomBytes', (n) => Buffer.alloc(n, batches++ === 0 ? 255 : 30), () => newCode()), ALPHABET[30].repeat(12), 'the first batch of 255 is dropped');
  assert.equal(withCrypto('randomBytes', (n) => Buffer.alloc(n, 247), () => newCode()), ALPHABET[247 % 31].repeat(12), '247 is the last byte that is used');
});

test('check: unknown, empty, non string and revoked codes are null; a known code gives its label; case and edge spaces do not matter', () => {
  const dir = tempDir();
  const store = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: quiet });
  assert.equal(store.check('ANYTHING'), null, 'no invites.json yet');
  const code = store.add('pilot-1');
  const other = store.add('pilot-2');
  assert.deepEqual(store.check(code), { label: 'pilot-1', usedToday: false });
  assert.deepEqual(store.check(other), { label: 'pilot-2', usedToday: false });
  assert.deepEqual(store.check(` ${code.toLowerCase()} `), { label: 'pilot-1', usedToday: false });
  for (const bad of ['', ' ', 'WRONG', code.slice(0, 11), code + 'A', undefined, null, 5, {}, [code], true, code.replace(/./, '0')]) assert.equal(store.check(bad), null, String(bad));
  store.revoke('pilot-1');
  assert.equal(store.check(code), null, 'revoked');
  assert.deepEqual(store.check(other), { label: 'pilot-2', usedToday: false });
});

test('the code is compared with crypto.timingSafeEqual, against every stored hash with no early exit', () => {
  const dir = tempDir();
  const store = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: quiet });
  const first = store.add('one');
  store.add('two');
  store.add('three');
  for (const code of [first, 'WRONGWRONG12']) {
    const result = withCrypto('timingSafeEqual', (a, b) => realTimingSafeEqual(a, b), (m) => {
      const found = store.check(code);
      assert.equal(m.calls.length, 3, 'one comparison per stored invite, whether or not the first one matches');
      for (const c of m.calls) assert.deepEqual(c.arguments.map((b) => b.length), [32, 32]);
      return found;
    });
    assert.equal(result === null, code !== first);
  }
});

test('one use per America/Los_Angeles day: the day turns at local midnight, in winter (PST), in summer (PDT) and over the clock change, and reset clears it', () => {
  const dir = tempDir();
  const clock = { t: new Date('2026-11-11T07:59:00Z') }; // 23:59 on Nov 10 in Los Angeles
  const store = createInviteStore({ dataDir: dir, now: () => clock.t, log: quiet });
  const code = store.add('pilot-1');
  const usedAt = (iso) => {
    clock.t = new Date(iso);
    return store.check(code).usedToday;
  };
  store.recordUse('pilot-1');
  assert.equal(usedAt('2026-11-11T07:59:59Z'), true);
  assert.equal(usedAt('2026-11-11T08:00:00Z'), false, 'midnight PST is 08:00 UTC');
  store.recordUse('pilot-1');
  assert.equal(usedAt('2026-11-12T07:59:59Z'), true, 'a UTC date change in the afternoon is not a new day in Los Angeles');
  assert.equal(usedAt('2026-11-12T08:00:00Z'), false);

  clock.t = new Date('2026-07-04T06:59:59Z');
  store.recordUse('pilot-1');
  assert.equal(usedAt('2026-07-04T06:59:59Z'), true);
  assert.equal(usedAt('2026-07-04T07:00:00Z'), false, 'midnight PDT is 07:00 UTC');

  // Nov 1 2026 has 25 hours (daylight saving ends): it starts at 07:00 UTC and ends at 08:00 UTC the next morning
  clock.t = new Date('2026-11-01T07:00:00Z');
  store.recordUse('pilot-1');
  assert.equal(usedAt('2026-11-02T07:59:59Z'), true, 'still Nov 1, 25 hours later');
  assert.equal(usedAt('2026-11-02T08:00:00Z'), false);

  clock.t = new Date('2026-11-11T20:00:00Z');
  store.recordUse('pilot-1');
  assert.equal(store.check(code).usedToday, true);
  store.reset('pilot-1');
  assert.equal(store.check(code).usedToday, false, 'reset gives the code its run back');
  assert.throws(() => store.reset('nobody'), /no invite labelled nobody/);
  assert.throws(() => store.recordUse('nobody'), /no invite labelled nobody/);
});

test('every call reads invites.json again, so a code added or revoked by the admin tool applies to a running server', () => {
  const dir = tempDir();
  const running = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: quiet });
  const tool = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: quiet });
  const code = tool.add('late');
  assert.deepEqual(running.check(code), { label: 'late', usedToday: false });
  running.recordUse('late');
  assert.equal(tool.check(code).usedToday, true, 'a use recorded by the server is seen by the admin tool');
  tool.revoke('late');
  assert.equal(running.check(code), null);
});

test('a corrupt or hostile invites.json refuses every code and is never overwritten', () => {
  const dir = tempDir();
  const errors = [];
  const store = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: { ...quiet, error: (m) => errors.push(m) } });
  const code = store.add('pilot-1');
  const file = join(dir, 'invites.json');
  const good = JSON.parse(readFileSync(file, 'utf8'));
  const entry = good.invites[0];
  const bad = [
    '{not json', '[]', 'null', JSON.stringify({ salt: 'zz', invites: [] }), JSON.stringify({ ...good, invites: 'x' }), JSON.stringify({ ...good, invites: [null] }),
    JSON.stringify({ ...good, invites: [{ ...entry, hash: 'abc' }] }), JSON.stringify({ ...good, invites: [{ ...entry, label: 5 }] }), JSON.stringify({ ...good, invites: [{ ...entry, revoked: 'no' }] }),
    JSON.stringify({ ...good, invites: [{ ...entry, last_used_day: 20261111 }] }),
  ];
  for (const text of bad) {
    writeFileSync(file, text);
    assert.equal(store.check(code), null, text);
    assert.throws(() => store.add('another'), /invites\.json/, text);
    assert.equal(readFileSync(file, 'utf8'), text, 'left as it was');
    const r = admin(dir, 'invite', 'list');
    assert.equal(r.code, 1, text);
    assert.match(r.err, /invites\.json/);
  }
  assert.ok(errors.length >= bad.length && errors.every((m) => /invites\.json/.test(m)));
});

test('an invites.json that exists but cannot be read is an error, not an empty store', () => {
  const dir = tempDir();
  const errors = [];
  const store = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: { ...quiet, error: (m) => errors.push(m) } });
  mkdirSync(join(dir, 'invites.json')); // reading a folder fails with something other than "not found"
  assert.equal(store.check('ABCDEFGHJKMN'), null);
  assert.equal(errors.length, 1, 'said so, instead of treating the store as empty');
  assert.throws(() => store.list(), /invites\.json/);
  assert.equal(admin(dir, 'invite', 'list').code, 1);
});

test('admin invite: add, list, reset and revoke, with refusals (exit 1) that name the problem and usage errors (exit 2)', () => {
  const dir = tempDir();
  assert.equal(admin(dir, 'invite', 'add', 'pilot-1').code, 0);
  const code2 = codeOf(admin(dir, 'invite', 'add', 'pilot-2').out);
  const again = admin(dir, 'invite', 'add', 'pilot-1');
  assert.equal(again.code, 1, 'a label is unique');
  assert.match(again.err, /already exists/);
  for (const label of ['', ' ', 'a b', '../x', 'x'.repeat(41), '.lead', '_lead', 'ünï', 'a\nb']) {
    const r = admin(dir, 'invite', 'add', label);
    assert.equal(r.code, 1, JSON.stringify(label));
    assert.match(r.err, /label/);
  }
  assert.equal(JSON.parse(readFileSync(join(dir, 'invites.json'), 'utf8')).invites.length, 2, 'refused labels added nothing');

  const store = createInviteStore({ dataDir: dir, now: at('2026-11-11T20:00:00Z'), log: quiet });
  store.recordUse('pilot-2');
  const listed = admin(dir, 'invite', 'list');
  assert.equal(listed.code, 0);
  const row = (text, label) => text.split('\n').find((l) => l.startsWith(label + ' '));
  assert.match(row(listed.out, 'pilot-1'), /active\s+never used/);
  assert.match(row(listed.out, 'pilot-2'), /active\s+last used 2026-11-11/);
  assert.equal(admin(dir, 'invite', 'revoke', 'pilot-2').code, 0);
  assert.match(row(admin(dir, 'invite', 'list').out, 'pilot-2'), /revoked/);
  assert.equal(store.check(code2), null);
  assert.equal(admin(dir, 'invite', 'reset', 'pilot-2').code, 0);
  assert.equal(admin(dir, 'invite', 'reset', 'pilot-1').code, 0);
  for (const args of [['invite', 'reset', 'nobody'], ['invite', 'revoke', 'nobody']]) {
    const r = admin(dir, ...args);
    assert.equal(r.code, 1);
    assert.match(r.err, /no invite labelled nobody/);
  }
  for (const args of [[], ['invite'], ['invite', 'add'], ['invite', 'nope'], ['invite', 'add', 'a', 'b'], ['nope'], ['live'], ['live', 'x'], ['spend', 'extra']]) {
    const r = admin(dir, ...args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.err, /usage/i);
    assert.equal(r.out, '');
  }
});

test('the admin tool only edits files under the data dir (a relative --data-dir included) and has no way to reach the network', () => {
  const dir = tempDir();
  const r = admin(dir, 'invite', 'add', 'pilot-1');
  assert.deepEqual(readdirSync(r.cwd), [], 'nothing is written next to the working folder');
  assert.deepEqual(readdirSync(dir), ['invites.json']);
  const rel = spawnSync(process.execPath, [ADMIN, '--data-dir', 'rel-data', 'invite', 'add', 'pilot-9'], { encoding: 'utf8', cwd: r.cwd });
  assert.equal(rel.status, 0, rel.stderr);
  assert.deepEqual(readdirSync(r.cwd), ['rel-data'], 'a relative --data-dir is resolved against the working folder');
  const allowed = ['node:crypto', 'node:fs', 'node:path', 'node:url'];
  for (const file of ['admin.mjs', 'invites.mjs', 'ledger.mjs']) {
    const text = readFileSync(join(serverDir, file), 'utf8');
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.length > 0, file);
    for (const spec of imports) assert.ok(spec.startsWith('./') || allowed.includes(spec), `${file} imports ${spec}`);
    assert.ok(!/\bfetch\(|\bWebSocket\b|XMLHttpRequest|\bimport\(|\bspawn(Sync)?\(|\bexec(Sync|File)?\(/.test(text), `${file} reaches for the network or another program`);
  }
});

test('with the real store: a code works once per Los Angeles day, again the next day, and the admin tool changes apply without a restart', async () => {
  const clock = { t: new Date('2026-11-11T20:00:00Z') };
  const dataDir = tempDir();
  const invites = createInviteStore({ dataDir, now: () => clock.t, log: quiet });
  const { base } = await startApp({ dataDir, invites, now: () => clock.t });
  const code = invites.add('pilot-1');
  const first = await post(base, request({ invite_code: code }));
  assert.equal(first.status, 202);
  assertJob(first.json);
  assertError(await post(base, request({ invite_code: code })), 'invite_used_today', 429);
  clock.t = new Date('2026-11-12T07:59:00Z'); // 23:59 in Los Angeles: still the same day
  assertError(await post(base, request({ invite_code: code })), 'invite_used_today', 429);
  clock.t = new Date('2026-11-12T08:00:00Z');
  assert.equal((await post(base, request({ invite_code: code }))).status, 202, 'the next day it works');
  assertError(await post(base, request({ invite_code: code })), 'invite_used_today', 429);

  const added = admin(dataDir, 'invite', 'add', 'pilot-2'); // another process, while the server runs
  assert.equal((await post(base, request({ invite_code: codeOf(added.out) }))).status, 202);
  assert.equal(admin(dataDir, 'invite', 'reset', 'pilot-1').code, 0);
  assert.equal((await post(base, request({ invite_code: code }))).status, 202, 'reset gives the run back the same day');
  assert.equal(admin(dataDir, 'invite', 'revoke', 'pilot-1').code, 0);
  assertError(await post(base, request({ invite_code: code })), 'invite_invalid', 403);
  assertError(await post(base, request({ invite_code: 'NOTACODE2345' })), 'invite_invalid', 403);
  await finished(base, first.json.job_id);
});

// ---- the server program (server.mjs as a process): the real invite store and the cap are wired in ----

const SERVER = join(serverDir, 'server.mjs');
async function withServerProgram(dataDir, extraArgs, fn) {
  const child = spawn(process.execPath, [SERVER, '--port', '0', '--data-dir', dataDir, '--orchestrator', FAKE, '--allow-local', ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', () => {});
  try {
    const port = await waitFor(() => /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1], 'the server program to listen');
    return await fn(`http://127.0.0.1:${port}`, () => out);
  } finally {
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    if (child.exitCode === null) await gone;
  }
}

test('the server program: invite add, then a real POST works once per day; admin live makes a queued job live only under a dollar cap, and the default cap of 0 refuses it', async () => {
  for (const [cap, args] of [[0, []], [100, ['--daily-usd-cap', '100']]]) {
    const dataDir = tempDir();
    await withServerProgram(dataDir, args, async (base, output) => {
      await waitFor(() => /Daily dollar cap/.test(output()), 'the startup lines'); // they can arrive after the line with the port
      assert.match(output(), new RegExp(`Daily dollar cap for live runs: \\$${cap}\\.00`));
      assert.match(output(), /invites\.json/);
      const code = codeOf(admin(dataDir, 'invite', 'add', 'pilot-1').out);
      const other = codeOf(admin(dataDir, 'invite', 'add', 'pilot-2').out);
      const first = await post(base, request({ invite_code: code, url: 'http://127.0.0.1:9/?gate=1' }));
      assert.equal(first.status, 202, JSON.stringify(first.json));
      assertError(await post(base, request({ invite_code: code, url: 'http://127.0.0.1:9/?n=1' })), 'invite_used_today', 429);
      assertError(await post(base, request({ invite_code: 'NOTACODE2345', url: 'http://127.0.0.1:9/?n=1' })), 'invite_invalid', 403);
      const second = await post(base, request({ invite_code: other, url: 'http://127.0.0.1:9/?n=2' }));
      assert.equal(second.status, 202);
      assert.equal(admin(dataDir, 'live', second.json.job_id, 'on').code, 0);
      writeFileSync(join(jobDir(dataDir, first.json.job_id), 'go'), '');
      assert.equal((await finished(base, first.json.job_id)).mode, 'free');
      const ran = await finished(base, second.json.job_id);
      assert.equal(ran.mode, 'live');
      if (cap === 0) {
        assert.deepEqual([ran.status, ran.error.code, ran.started_at], ['failed', 'budget', null]);
      } else {
        assert.equal(ran.status, 'done');
        assert.ok(argvOf(dataDir, second.json.job_id).includes('--live'));
      }
    });
  }
});

test('--daily-usd-cap must be a number of dollars, 0 or more: anything else is a usage error (exit 2) before the server starts', () => {
  for (const args of [['--daily-usd-cap', 'abc'], ['--daily-usd-cap', ''], ['--daily-usd-cap', ' '], ['--daily-usd-cap', 'NaN'], ['--daily-usd-cap', 'Infinity'], ['--daily-usd-cap', '1,5'], ['--daily-usd-cap=-1'], ['--daily-usd-cap', '-1'], ['--daily-usd-cap']]) {
    const r = spawnSync(process.execPath, [SERVER, '--port', '0', '--data-dir', tempDir(), ...args], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
    assert.match(r.stderr, /--daily-usd-cap/);
  }
});
