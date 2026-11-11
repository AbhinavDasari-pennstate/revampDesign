// Tests for the job server (plan/web-plan.md T40): POST /api/jobs, GET /api/jobs/:id, the one-at-a-time queue, static files and the app CSP.
// The server runs for real on an ephemeral 127.0.0.1 port; the orchestrator is test/fake-orchestrator.mjs and DNS is a fake lookup, so there is no crawl and no network.
// Every JSON body is checked against the frozen contract (see checkByHand and assertValid below).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp, nodeNote } from '../server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-orchestrator.mjs');
const contracts = resolve(here, '../../../contracts');
const VIEWER = 'http://127.0.0.1:8788';
const fixture = (name) => JSON.parse(readFileSync(join(contracts, 'web/fixtures', name), 'utf8'));

// The contract is checked twice. checkByHand always runs, because CI installs nothing for web/ (.github/scripts/test/ci.test.mjs).
// When contracts/node_modules exists (npm ci in contracts/), every body is also validated against the real schemas with ajv.
let ajv = null;
try {
  const { default: Ajv2020 } = await import(pathToFileURL(join(contracts, 'node_modules/ajv/dist/2020.js')).href);
  ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const f of readdirSync(join(contracts, 'web/schemas'))) ajv.addSchema(JSON.parse(readFileSync(join(contracts, 'web/schemas', f), 'utf8')));
} catch {
  console.warn('contracts/node_modules is not installed: response bodies are checked by hand only. Run npm ci in contracts/ for the full schema check.');
}
const STAGE_NAMES = ['scout', 'story', 'art', 'council', 'select', 'build'];
const RUN_ERRORS = Object.fromEntries(['site_blocked', 'quality_gate', 'budget', 'not_real', 'timeout', 'crash', 'server_restarted'].map((c) => [c, fixture(`job-failed-${c}.json`).error]));
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MANIFEST_URL = /^https?:\/\/[^/\s?#]+\/j\/[A-Za-z0-9_-]{22}\/manifest\.json$/;
const keysOf = (o, keys) => assert.deepEqual(Object.keys(o).sort(), [...keys].sort());

function checkByHand(id, data) {
  if (id === 'error.v1') return; // every error body is compared with its contract fixture in assertError
  if (id === 'job.v1') {
    keysOf(data, ['job_id', 'status', 'position', 'mode', 'stages', 'created_at', 'started_at', 'finished_at', 'error', 'manifest_url']);
    assert.match(data.job_id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(['free', 'live'].includes(data.mode));
    assert.deepEqual(data.stages.map((s) => s.stage), STAGE_NAMES);
    for (const s of data.stages) {
      keysOf(s, ['stage', 'state']);
      assert.ok(['pending', 'running', 'done', 'failed'].includes(s.state));
    }
    assert.ok(data.stages.filter((s) => s.state === 'running').length <= 1);
    assert.match(data.created_at, TIMESTAMP);
    for (const t of [data.started_at, data.finished_at]) assert.ok(t === null || TIMESTAMP.test(t));
    const isTime = (t) => typeof t === 'string' && TIMESTAMP.test(t);
    if (data.status === 'queued') assert.deepEqual([Number.isInteger(data.position) && data.position >= 1, data.started_at, data.finished_at, data.error, data.manifest_url], [true, null, null, null, null]);
    else if (data.status === 'running') assert.deepEqual([data.position, isTime(data.started_at), data.finished_at, data.error, data.manifest_url], [null, true, null, null, null]);
    else if (data.status === 'done') assert.deepEqual([data.position, isTime(data.started_at), isTime(data.finished_at), data.error, MANIFEST_URL.test(data.manifest_url)], [null, true, true, null, true]);
    else if (data.status === 'failed') assert.deepEqual([data.position, isTime(data.finished_at), data.error, data.manifest_url], [null, true, RUN_ERRORS[data.error?.code], null]);
    else assert.fail(`unknown status ${data.status}`);
    return;
  }
  const name = id.split('/').pop(); // event.v1#/$defs/<name>
  if (name === 'queued') { keysOf(data, ['position']); assert.ok(Number.isInteger(data.position) && data.position >= 1); }
  else if (name === 'started') { keysOf(data, ['mode']); assert.ok(['free', 'live'].includes(data.mode)); }
  else if (name === 'stage') { keysOf(data, ['stage', 'state']); assert.ok(STAGE_NAMES.includes(data.stage) && ['running', 'done', 'failed'].includes(data.state)); }
  else if (name === 'done') { keysOf(data, ['manifest_url']); assert.match(data.manifest_url, MANIFEST_URL); }
  else if (name === 'failed') assert.deepEqual(data, RUN_ERRORS[data.code]);
  else assert.fail(`no hand check for ${id}`);
}

function assertValid(id, data) {
  checkByHand(id, data);
  if (!ajv) return;
  const validate = ajv.getSchema(id);
  assert.ok(validate, `schema ${id} is not registered`);
  assert.ok(validate(data), `${id}: ${JSON.stringify(validate.errors)} in ${JSON.stringify(data)}`);
}
const assertJob = (data) => assertValid('job.v1', data);
const assertError = (res, code, status) => {
  assert.equal(res.status, status, `status for ${code}`);
  assertValid('error.v1', res.json);
  assert.deepEqual(res.json, fixture(`error-${code}.json`), `body for ${code} equals the contract fixture`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// ---- harness ----

const apps = [];
const dirs = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'web-server-test-'));
  dirs.push(d);
  return d;
};

// Invite store stand-ins (the real one is T47). allowAll accepts any non-empty code; oneUse also remembers who ran today.
const allowAll = () => ({ check: (code) => (typeof code === 'string' && code !== '' ? { label: `label-${code}`, usedToday: false } : null), recordUse() {} });
const oneUse = () => {
  const used = new Set();
  return { used, check: (code) => (typeof code === 'string' && code !== '' ? { label: `label-${code}`, usedToday: used.has(`label-${code}`) } : null), recordUse: (label) => used.add(label) };
};

async function startApp(opts = {}) {
  const dataDir = opts.dataDir ?? tempDir();
  const lookups = [];
  const lookup = async (host) => {
    lookups.push(host);
    return host.startsWith('private') ? ['10.0.0.9'] : ['93.184.216.34'];
  };
  const config = { dataDir, orchestrator: FAKE, uiDir: join(dataDir, 'no-ui'), lookup, invites: allowAll(), timeoutMs: 120000, viewerOrigin: VIEWER, log: { log() {}, error() {} }, ...opts };
  if (opts.noInvites) delete config.invites;
  const app = createApp(config);
  apps.push(app);
  await app.listen(0);
  return { app, dataDir, lookups, base: `http://127.0.0.1:${app.port}` };
}

async function call(base, method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}
const post = (base, body) => call(base, 'POST', '/api/jobs', body);
const getJob = (base, id) => call(base, 'GET', `/api/jobs/${id}`);

// The raw request line, untouched by any URL normalising (fetch would turn /../x into /x).
function raw(base, method, path) {
  return new Promise((resolveReq, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, method, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveReq({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const site = (params = {}, host = 'school.example') => `https://${host}/?${new URLSearchParams(params)}`;
const request = (over = {}) => ({ invite_code: 'K7M2PQ9XWD4R', url: site(), owner_name: 'Dana Whitfield', consent: true, ...over });
const jobDir = (dataDir, id) => join(dataDir, 'jobs', id);
const finished = (base, id) => waitFor(async () => {
  const j = (await getJob(base, id)).json;
  return j.status === 'done' || j.status === 'failed' ? j : null;
}, `job ${id} to finish`);

// ---- the by-hand check itself ----

test('the by-hand contract check accepts every contract fixture and rejects wrong bodies, so CI without ajv still guards the shapes', () => {
  for (const name of readdirSync(join(contracts, 'web/fixtures')).filter((n) => /^job-.*\.json$/.test(n))) checkByHand('job.v1', fixture(name));
  const done = fixture('job-done.json');
  const failed = fixture('job-failed-crash.json');
  const queued = fixture('job-queued.json');
  const wrongJobs = [
    { ...done, status: 'running' }, { ...done, extra: 1 }, { ...done, manifest_url: null }, { ...done, position: 2 }, { ...done, stages: done.stages.slice(1) },
    { ...done, created_at: '2026-11-11' }, { ...done, mode: 'paid' }, { ...done, job_id: 'short' }, { ...queued, position: 0 }, { ...queued, started_at: done.started_at },
    { ...failed, error: { ...failed.error, message: 'Something broke.' } }, { ...failed, error: { code: 'made_up', message: 'x' } }, { ...failed, error: null },
    { ...done, stages: done.stages.map((s) => ({ ...s, state: 'running' })) },
  ];
  for (const bad of wrongJobs) assert.throws(() => checkByHand('job.v1', bad), JSON.stringify(bad).slice(0, 80));
  for (const [name, data] of [['queued', { position: 0 }], ['queued', { position: 1, x: 1 }], ['started', { mode: 'x' }], ['stage', { stage: 'build', state: 'pending' }], ['done', { manifest_url: 'http://x/y' }], ['failed', { code: 'crash', message: 'x' }]]) {
    assert.throws(() => checkByHand(`event.v1#/$defs/${name}`, data), name);
  }
});

// ---- the contract's own request ----

test('the contract fixture request is accepted: 202, a queued job.v1, position 1, free mode, six pending stages', async () => {
  const { base } = await startApp();
  const res = await post(base, fixture('start-request.json'));
  assert.equal(res.status, 202);
  assertJob(res.json);
  assert.equal(res.json.status, 'queued');
  assert.equal(res.json.position, 1);
  assert.equal(res.json.mode, 'free');
  assert.deepEqual(res.json.stages.map((s) => s.state), Array(6).fill('pending'));
  assert.equal(res.json.started_at, null);
  assert.equal(res.json.finished_at, null);
  assert.equal(res.json.error, null);
  assert.equal(res.json.manifest_url, null);
  assert.match(res.json.job_id, /^[A-Za-z0-9_-]{22}$/);
});

test('API responses are JSON, nosniff, uncached and set no cookie', async () => {
  const { base } = await startApp();
  for (const res of [await post(base, request()), await post(base, '{'), await call(base, 'GET', '/api/nope')]) {
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('set-cookie'), null);
  }
});

test('job ids are 22 base64url characters, unique, and never contain the invite code', async () => {
  const { base } = await startApp();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await post(base, request({ invite_code: 'SECRETCODE12', url: site({ sleep: 50 }, `s${i}.example`) }))).json.job_id);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) {
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(!id.includes('SECRETCODE12'));
  }
});

// ---- the one-at-a-time queue ----

test('two POSTs give positions 1 and 2, and the second job starts only after the first has exited', async () => {
  const { base, dataDir } = await startApp();
  const a = await post(base, request({ url: site({ sleep: 700 }, 'a.example') }));
  const b = await post(base, request({ url: site({ sleep: 100 }, 'b.example') }));
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assertJob(a.json);
  assertJob(b.json);
  assert.equal(a.json.position, 1);
  assert.equal(b.json.position, 2);
  assert.equal(b.json.status, 'queued');

  await waitFor(async () => (await getJob(base, a.json.job_id)).json.status === 'running', 'job A running');
  const whileRunning = await getJob(base, a.json.job_id);
  assertJob(whileRunning.json);
  assert.equal(whileRunning.json.position, null);
  assert.notEqual(whileRunning.json.started_at, null);
  assert.equal(whileRunning.json.finished_at, null);
  for (let i = 0; i < 5; i++) {
    const waiting = await getJob(base, b.json.job_id);
    assertJob(waiting.json);
    assert.equal(waiting.json.status, 'queued');
    assert.equal(waiting.json.position, 2);
    await sleep(50);
  }

  const doneA = await finished(base, a.json.job_id);
  const doneB = await finished(base, b.json.job_id);
  assertJob(doneA);
  assertJob(doneB);
  assert.equal(doneA.status, 'done');
  assert.equal(doneB.status, 'done');
  const timing = (id) => JSON.parse(readFileSync(join(jobDir(dataDir, id), 'fake-timing.json'), 'utf8'));
  assert.ok(timing(b.json.job_id).start >= timing(a.json.job_id).end, 'B started after A ended');
});

test('a finished run is done with six done stages, no position and the viewer manifest url', async () => {
  const { base } = await startApp();
  const { json: posted } = await post(base, request());
  const job = await finished(base, posted.job_id);
  assertJob(job);
  assert.equal(job.status, 'done');
  assert.equal(job.position, null);
  assert.deepEqual(job.stages.map((s) => s.state), Array(6).fill('done'));
  assert.equal(job.manifest_url, `${VIEWER}/j/${posted.job_id}/manifest.json`);
  assert.equal(job.error, null);
  assert.ok(Date.parse(job.started_at) >= Date.parse(job.created_at));
  assert.ok(Date.parse(job.finished_at) >= Date.parse(job.started_at));
  assert.deepEqual(job.mode, 'free');
});

test('a run that exits with a non-zero code is failed with the fixed crash text and none of the orchestrator output', async () => {
  const { base, dataDir } = await startApp();
  const { json: posted } = await post(base, request({ url: site({ exit: 1, noise: 1 }) }));
  const job = await finished(base, posted.job_id);
  assertJob(job);
  assert.equal(job.status, 'failed');
  assert.deepEqual(job.error, fixture('job-failed-crash.json').error);
  assert.equal(job.manifest_url, null);
  assert.equal(job.position, null);
  assert.ok(!JSON.stringify(job).includes('SECRET'));
  assert.ok(readFileSync(join(jobDir(dataDir, posted.job_id), 'console.log'), 'utf8').includes('SECRET-STDOUT-MARKER'));
});

test('the 6th place in line is refused with queue_full (the running job counts as a place)', async () => {
  const { base } = await startApp();
  const sleepy = (i) => request({ url: site({ sleep: 60000 }, `q${i}.example`) });
  const positions = [];
  for (let i = 1; i <= 5; i++) {
    const res = await post(base, sleepy(i));
    assert.equal(res.status, 202, `POST ${i}`);
    positions.push(res.json.position);
  }
  assert.deepEqual(positions, [1, 2, 3, 4, 5]);
  assertError(await post(base, sleepy(6)), 'queue_full', 503);
});

test('a queue_full refusal does not use up the invite code, and a code can start only one run a day', async () => {
  const invites = oneUse();
  const { base } = await startApp({ invites, maxLine: 1 });
  assert.equal((await post(base, request({ invite_code: 'AAAA', url: site({ sleep: 60000 }, 'a.example') }))).status, 202);
  assertError(await post(base, request({ invite_code: 'BBBB' })), 'queue_full', 503);
  assert.deepEqual([...invites.used], ['label-AAAA']);
  assertError(await post(base, request({ invite_code: 'AAAA' })), 'invite_used_today', 429);
});

test('two parallel POSTs with one invite code start exactly one run', async () => {
  const invites = oneUse();
  const slowLookup = async () => (await sleep(100), ['93.184.216.34']); // both requests are past the first invite check before either is accepted
  const { base } = await startApp({ invites, lookup: slowLookup });
  const [x, y] = await Promise.all([post(base, request({ url: site({ sleep: 200 }, 'x.example') })), post(base, request({ url: site({ sleep: 200 }, 'y.example') }))]);
  assert.deepEqual([x.status, y.status].sort(), [202, 429]);
  assertError(x.status === 429 ? x : y, 'invite_used_today', 429);
});

test('queue events, shaped like event.v1, say queued, queued again when the place changes, started and done', async () => {
  const { app, base } = await startApp();
  const events = [];
  app.queue.on('event', (jobId, name, data) => events.push({ jobId, name, data }));
  const a = (await post(base, request({ url: site({ sleep: 300 }, 'a.example') }))).json.job_id;
  const b = (await post(base, request({ url: site({ sleep: 50 }, 'b.example') }))).json.job_id;
  await finished(base, b);
  await waitFor(() => events.some((e) => e.jobId === b && e.name === 'done'), 'B done event');
  for (const e of events) assertValid(`event.v1#/$defs/${e.name}`, e.data);
  const seq = (id) => events.filter((e) => e.jobId === id).map((e) => (e.name === 'queued' ? `queued:${e.data.position}` : e.name));
  assert.deepEqual(seq(a), ['queued:1', 'started', 'done']);
  assert.deepEqual(seq(b), ['queued:2', 'queued:1', 'started', 'done']);
  assert.deepEqual(events.find((e) => e.jobId === a && e.name === 'started').data, { mode: 'free' });
  assert.deepEqual(events.find((e) => e.jobId === a && e.name === 'done').data, { manifest_url: `${VIEWER}/j/${a}/manifest.json` });
});

// ---- the process we start ----

test('the orchestrator gets an argument array with --consent-note and --out-dir <data dir>/jobs/<id>, never --live', async () => {
  const { base, dataDir } = await startApp();
  const t0 = Date.now();
  const { json: posted } = await post(base, request({ url: site({ x: '%PATH%' }), owner_name: 'Dana "D" O\'Neil %PATH% & | ^ 李\u0007\n' }));
  await finished(base, posted.job_id);
  const t1 = Date.now();
  const log = readFileSync(join(jobDir(dataDir, posted.job_id), 'console.log'), 'utf8');
  const argv = JSON.parse(log.split('\n').find((l) => l.startsWith('FAKE-ARGV ')).slice('FAKE-ARGV '.length));
  assert.deepEqual(argv.slice(0, 7), ['run', '--url', site({ x: '%PATH%' }), '--tier', 'B', '--consent-note', argv[6]]);
  assert.deepEqual(argv.slice(7), ['--out-dir', resolve(dataDir, 'jobs', posted.job_id)]);
  assert.ok(!argv.includes('--live'));
  const m = /^Owner (.*) confirmed consent in the tester app at (.+)$/.exec(argv[6]);
  assert.ok(m, argv[6]);
  assert.equal(m[1], 'Dana "D" O\'Neil %PATH% & | ^ 李', 'control characters gone, every other character intact');
  assert.equal(new Date(m[2]).toISOString(), m[2]);
  assert.ok(Date.parse(m[2]) >= t0 - 1000 && Date.parse(m[2]) <= t1);
});

test('the orchestrator is given the normalised address that was checked, not the text that was typed', async () => {
  const { base, dataDir } = await startApp();
  const { json: posted } = await post(base, request({ url: 'HTTPS://School.EXAMPLE/?noise=0' }));
  await finished(base, posted.job_id);
  const log = readFileSync(join(jobDir(dataDir, posted.job_id), 'console.log'), 'utf8');
  const argv = JSON.parse(log.split('\n').find((l) => l.startsWith('FAKE-ARGV ')).slice('FAKE-ARGV '.length));
  assert.equal(argv[2], 'https://school.example/?noise=0');
});

test('the owner name in the consent note is capped at 100 code points (an emoji counts once) and a 200 point name is still accepted', async () => {
  const { base, dataDir } = await startApp();
  const { json: posted } = await post(base, request({ owner_name: '😀'.repeat(200) }));
  await finished(base, posted.job_id);
  const log = readFileSync(join(jobDir(dataDir, posted.job_id), 'console.log'), 'utf8');
  const argv = JSON.parse(log.split('\n').find((l) => l.startsWith('FAKE-ARGV ')).slice('FAKE-ARGV '.length));
  assert.match(argv[6], new RegExp(`^Owner ${'😀'.repeat(100)} confirmed consent in the tester app at `));
});

test('orchestrator stdout and stderr go to console.log in the job folder and never to the tester', async () => {
  const { base, dataDir } = await startApp();
  const created = await post(base, request({ url: site({ noise: 1 }) }));
  const job = await finished(base, created.json.job_id);
  const log = readFileSync(join(jobDir(dataDir, created.json.job_id), 'console.log'), 'utf8');
  assert.ok(log.includes('SECRET-STDOUT-MARKER') && log.includes('SECRET-STDERR-MARKER'));
  for (const text of [created.text, JSON.stringify(job)]) assert.ok(!text.includes('SECRET') && !text.includes('FAKE-ARGV'));
});

test('jobs are persisted as jobs/<id>/job.json, with the invite label and never the invite code', async () => {
  const { base, dataDir } = await startApp({ invites: { check: (code) => (code === 'PLAINCODE99' ? { label: 'pilot-1', usedToday: false } : null), recordUse() {} } });
  const created = await post(base, request({ invite_code: 'PLAINCODE99' }));
  const id = created.json.job_id;
  const file = join(jobDir(dataDir, id), 'job.json');
  assert.ok(existsSync(file), 'written before the response');
  assert.ok(['queued', 'running'].includes(JSON.parse(readFileSync(file, 'utf8')).status));
  await finished(base, id);
  const text = readFileSync(file, 'utf8');
  const saved = JSON.parse(text);
  assert.equal(saved.job_id, id);
  assert.equal(saved.status, 'done');
  assert.equal(saved.invite_label, 'pilot-1');
  assert.ok(!text.includes('PLAINCODE99'));
  assert.ok(!JSON.stringify((await getJob(base, id)).json).includes('pilot-1'), 'the label is internal, not part of job.v1');
});

// ---- restart and timeout ----

test('on restart a job left queued or running becomes failed with server_restarted, and a finished one is untouched', async () => {
  const dataDir = tempDir();
  const base = fixture('job-queued.json');
  const write = (id, patch) => {
    mkdirSync(join(dataDir, 'jobs', id), { recursive: true });
    writeFileSync(join(dataDir, 'jobs', id, 'job.json'), JSON.stringify({ ...base, job_id: id, ...patch, invite_label: 'x', url: 'https://school.example/', consent_note: 'n' }));
  };
  const stages = (...states) => ['scout', 'story', 'art', 'council', 'select', 'build'].map((stage, i) => ({ stage, state: states[i] ?? 'pending' }));
  const T = '2026-11-11T10:00:00.000Z';
  write('queuedJobQueuedJobQu01', {});
  write('runningJobRunningJob02', { status: 'running', position: null, started_at: T, stages: stages('done', 'done', 'running') });
  write('doneJobDoneJobDoneJo03', { status: 'done', position: null, started_at: T, finished_at: T, stages: stages(...Array(6).fill('done')), manifest_url: `${VIEWER}/j/doneJobDoneJobDoneJo03/manifest.json` });
  const { base: url } = await startApp({ dataDir });

  const queued = (await getJob(url, 'queuedJobQueuedJobQu01')).json;
  assertJob(queued);
  assert.equal(queued.status, 'failed');
  assert.deepEqual(queued.error, fixture('job-failed-server_restarted.json').error);
  assert.equal(queued.started_at, null);
  assert.deepEqual(queued.stages.map((s) => s.state), Array(6).fill('pending'));
  assert.equal(queued.position, null);
  assert.notEqual(queued.finished_at, null);

  const running = (await getJob(url, 'runningJobRunningJob02')).json;
  assertJob(running);
  assert.equal(running.status, 'failed');
  assert.equal(running.error.code, 'server_restarted');
  assert.equal(running.started_at, T);
  assert.deepEqual(running.stages.map((s) => s.state), ['done', 'done', 'failed', 'pending', 'pending', 'pending']);

  const done = (await getJob(url, 'doneJobDoneJobDoneJo03')).json;
  assertJob(done);
  assert.equal(done.status, 'done');
  assert.equal(JSON.parse(readFileSync(join(dataDir, 'jobs', 'queuedJobQueuedJobQu01', 'job.json'), 'utf8')).status, 'failed', 'persisted too');
});

test('stopping the server mid-run kills the whole process tree and leaves the job for the next start to fail as server_restarted', async () => {
  const dataDir = tempDir();
  const first = await startApp({ dataDir });
  const { json: posted } = await post(first.base, request({ url: site({ sleep: 60000, child: 1 }) }));
  const pidFile = join(jobDir(dataDir, posted.job_id), 'fake-grandchild.pid');
  await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 'the grandchild pid');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(alive(pid));
  await first.app.close();
  await waitFor(() => !alive(pid), 'the grandchild to die');
  assert.equal(JSON.parse(readFileSync(join(jobDir(dataDir, posted.job_id), 'job.json'), 'utf8')).status, 'running');

  const second = await startApp({ dataDir });
  const after = (await getJob(second.base, posted.job_id)).json;
  assertJob(after);
  assert.equal(after.status, 'failed');
  assert.equal(after.error.code, 'server_restarted');
});

test('a run longer than the timeout is killed with its whole process tree, fails with timeout, and the next job then runs', async () => {
  const { base, dataDir } = await startApp({ timeoutMs: 1500 });
  const a = (await post(base, request({ url: site({ sleep: 60000, child: 1 }, 'a.example') }))).json.job_id;
  const b = (await post(base, request({ url: site({}, 'b.example') }))).json.job_id;
  const failed = await finished(base, a);
  assertJob(failed);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.error, fixture('job-failed-timeout.json').error);
  assert.equal(failed.manifest_url, null);
  const pid = Number(readFileSync(join(jobDir(dataDir, a), 'fake-grandchild.pid'), 'utf8'));
  await waitFor(() => !alive(pid), 'the grandchild to die');
  const next = await finished(base, b);
  assert.equal(next.status, 'done');
});

// ---- the request checks, in contract order ----

const BAD_REQUEST_BODIES = {
  'not JSON': '{not json',
  'an empty body': '',
  'a JSON array': '[]',
  'JSON null': 'null',
  'a JSON string': '"hi"',
  'a field the schema does not list': { ...request(), extra: 1 },
  'a prototype field': '{"__proto__":{"x":1},"invite_code":"a","url":"https://a.example/","owner_name":"n","consent":true}',
  'an owner name of 201 code points': request({ owner_name: 'x'.repeat(201) }),
  'an owner name of 201 emoji': request({ owner_name: '😀'.repeat(201) }),
  'a body over 4 KiB': request({ owner_name: 'x'.repeat(5000) }),
  'a body that is not valid UTF-8': Buffer.concat([Buffer.from('{"invite_code":"a","url":"https://school.example/","owner_name":"Da'), Buffer.from([0xff]), Buffer.from('na","consent":true}')]),
};
test('rule 1: bad_request (400) for an unreadable body, an unknown field, an owner name over 200 code points or a body over 4 KiB', async () => {
  const { base, lookups } = await startApp();
  for (const [what, body] of Object.entries(BAD_REQUEST_BODIES)) assertError(await post(base, body), 'bad_request', 400, what);
  assert.deepEqual(lookups, []);
});

test('rule 1: the body limit is exactly 4096 bytes', async () => {
  const { base } = await startApp({ invites: { check: () => null, recordUse() {} } });
  const sized = (bytes) => {
    const make = (n) => JSON.stringify(request({ invite_code: 'x'.repeat(n) }));
    let n = 1;
    while (Buffer.byteLength(make(n)) < bytes) n++;
    return make(n);
  };
  assert.equal(Buffer.byteLength(sized(4096)), 4096);
  assertError(await post(base, sized(4096)), 'invite_invalid', 403); // read in full, passes rule 1, stops at rule 5
  assertError(await post(base, sized(4097)), 'bad_request', 400);
});

test('rule 2: bad_url (400) for a missing, non http address, credential or oversized url', async () => {
  const { base, lookups } = await startApp();
  const { url, ...noUrl } = request();
  const urls = [undefined, '', 5, null, [], 'example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/', 'https://user:pass@example.org/', 'https://user@example.org/', 'https://exa mple.org/', 'https://example.org/' + 'a'.repeat(2048)];
  for (const u of urls) assertError(await post(base, u === undefined ? noUrl : request({ url: u })), 'bad_url', 400);
  assert.deepEqual(lookups, []);
});

test('rule 3: owner_name_required (400) for a missing, non string or blank owner name, and one made only of control characters', async () => {
  const { base } = await startApp();
  const { owner_name, ...noName } = request();
  assertError(await post(base, noName), 'owner_name_required', 400);
  for (const n of ['', ' ', '   \t\n', 5, null, true, ['Dana'], '\u0000\u0007\u001b']) assertError(await post(base, request({ owner_name: n })), 'owner_name_required', 400);
});

test('rule 4: consent_required (400) unless consent is exactly the boolean true', async () => {
  const { base } = await startApp();
  const { consent, ...noConsent } = request();
  assertError(await post(base, noConsent), 'consent_required', 400);
  for (const c of [false, 'true', 1, null, 'yes', [true], {}]) assertError(await post(base, request({ consent: c })), 'consent_required', 400);
});

test('rule 5: invite_invalid (403) for a missing, empty, non string or unknown code, and every start request when no invite store is wired in', async () => {
  const known = { check: (code) => (code === 'GOODCODE' ? { label: 'good', usedToday: false } : null), recordUse() {} };
  const { base } = await startApp({ invites: known });
  const { invite_code, ...noCode } = request();
  assertError(await post(base, noCode), 'invite_invalid', 403);
  for (const c of ['', 5, null, 'WRONG', ['GOODCODE']]) assertError(await post(base, request({ invite_code: c })), 'invite_invalid', 403);
  assert.equal((await post(base, request({ invite_code: 'GOODCODE' }))).status, 202);

  const bare = await startApp({ noInvites: true });
  assertError(await post(bare.base, request()), 'invite_invalid', 403);
  assertError(await post(bare.base, fixture('start-request.json')), 'invite_invalid', 403);
});

test('rule 6: invite_used_today (429) when the code already started a run today', async () => {
  const invites = oneUse();
  const { base } = await startApp({ invites });
  assert.equal((await post(base, request({ invite_code: 'ONCE' }))).status, 202);
  assertError(await post(base, request({ invite_code: 'ONCE' })), 'invite_used_today', 429);
  assert.equal((await post(base, request({ invite_code: 'TWICE' }))).status, 202);
});

test('rule 8: host_not_public (400) for private, loopback and local targets, from literals, names and a name whose lookup is private', async () => {
  const { base } = await startApp();
  const urls = ['http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://[fc00::1]/', 'http://localhost/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'https://private.example/'];
  for (const url of urls) assertError(await post(base, request({ url })), 'host_not_public', 400, url);
});

test('rule 8: a name that does not resolve is refused as bad_url, and --allow-local is off by default', async () => {
  const { base } = await startApp({ lookup: async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); } });
  assertError(await post(base, request({ url: 'https://typo-school.example/' })), 'bad_url', 400);
  assertError(await post(base, request({ url: 'http://127.0.0.1:9/' })), 'host_not_public', 400);

  const local = await startApp({ allowLocal: true });
  const res = await post(local.base, request({ url: 'http://127.0.0.1:9/' }));
  assert.equal(res.status, 202);
  assertJob(res.json);
  assert.deepEqual(local.lookups, []);
});

test('rule 9: queue_full (503), after every earlier rule', async () => {
  const { base } = await startApp({ maxLine: 1 });
  assert.equal((await post(base, request({ url: site({ sleep: 60000 }, 'a.example') }))).status, 202);
  assertError(await post(base, request({ url: site({}, 'b.example') })), 'queue_full', 503);
  assertError(await post(base, request({ url: 'http://10.0.0.1/' })), 'host_not_public', 400);
  assertError(await post(base, request({ consent: false })), 'consent_required', 400);
});

test('the first failing rule wins, and no DNS lookup happens before rules 1 to 6 have passed', async () => {
  const invites = oneUse();
  invites.used.add('label-USED');
  const { base, lookups } = await startApp({ invites });
  const nothingRight = { invite_code: '', url: 'file:///x', owner_name: '', consent: false, extra: 1 };
  assertError(await post(base, nothingRight), 'bad_request', 400);
  const { extra, ...noExtra } = nothingRight;
  assertError(await post(base, noExtra), 'bad_url', 400);
  assertError(await post(base, { ...noExtra, url: 'https://private.example/' }), 'owner_name_required', 400);
  assertError(await post(base, { ...noExtra, url: 'https://private.example/', owner_name: 'Dana' }), 'consent_required', 400);
  assertError(await post(base, { ...noExtra, url: 'https://private.example/', owner_name: 'Dana', consent: true }), 'invite_invalid', 403);
  assertError(await post(base, { invite_code: 'USED', url: 'https://private.example/', owner_name: 'Dana', consent: true }), 'invite_used_today', 429);
  assert.deepEqual(lookups, [], 'a caller without a valid code cannot make the server resolve names');
  assertError(await post(base, request({ invite_code: 'FRESH', url: 'https://private.example/' })), 'host_not_public', 400);
  assert.deepEqual(lookups, ['private.example']);
  assert.deepEqual([...invites.used], ['label-USED'], 'a refused request never uses up a code');
});

// ---- GET /api/jobs/:id and the rest of /api ----

test('GET /api/jobs/:id answers 404 not_found for an unknown id and for anything that is not a job id', async () => {
  const { base } = await startApp();
  for (const id of ['Xk3nP9qLm2VbT7sRw4YdHa', 'abc', 'x'.repeat(22) + 'y', 'Xk3nP9qLm2VbT7sRw4Yd!a', '..', '%2e%2e', 'constructor', '__proto__', 'toString']) {
    assertError(await call(base, 'GET', `/api/jobs/${id}`), 'not_found', 404);
  }
});

test('any other path or method under /api answers 404 not_found', async () => {
  const { base } = await startApp();
  const { json: posted } = await post(base, request());
  for (const [method, path] of [['GET', '/api/jobs'], ['GET', '/api'], ['GET', '/api/'], ['GET', '/api/nope'], ['DELETE', `/api/jobs/${posted.job_id}`], ['POST', `/api/jobs/${posted.job_id}`], ['PUT', '/api/jobs'], ['PATCH', '/api/jobs'], ['GET', `/api/jobs/${posted.job_id}/`], ['GET', `/api/jobs/${posted.job_id}/nope`], ['HEAD', `/api/jobs/${posted.job_id}`], ['OPTIONS', '/api/jobs']]) {
    const res = await call(base, method, path, method === 'POST' || method === 'PUT' || method === 'PATCH' ? {} : undefined);
    assert.equal(res.status, 404, `${method} ${path}`);
    if (method !== 'HEAD') assertError(res, 'not_found', 404);
  }
});

// ---- the process and the static files ----

test('the server listens on 127.0.0.1 only', async () => {
  const { app } = await startApp();
  assert.deepEqual({ address: app.server.address().address, family: app.server.address().family }, { address: '127.0.0.1', family: 'IPv4' });
});

const APP_CSP = `default-src 'self'; frame-src 'self' ${VIEWER}; img-src 'self' ${VIEWER}; connect-src 'self' ${VIEWER}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
const header = (res, name) => (typeof res.headers.get === 'function' ? res.headers.get(name) : res.headers[name]);

test('without web/ui the server serves a placeholder page with the app CSP', async () => {
  const { base } = await startApp();
  for (const path of ['/', '/index.html', '/ui/', '/ui']) {
    const res = await call(base, 'GET', path);
    assert.equal(res.status, 200, path);
    assert.equal(header(res, 'content-type'), 'text/html; charset=utf-8');
    assert.equal(header(res, 'content-security-policy'), APP_CSP);
    assert.match(res.text, /<title>[^<]+<\/title>/);
  }
});

function makeUi(dir) {
  const ui = join(dir, 'ui');
  for (const [p, text] of Object.entries({
    'index.html': '<!doctype html><title>Start</title><p>start page',
    'job.html': '<!doctype html><title>Job</title>',
    'css/app.css': 'body{margin:0}',
    'js/api.mjs': 'export const x = 1;',
    'img/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'dev/mock-server.mjs': 'DEV-ONLY',
    'test/a.test.mjs': 'TEST-ONLY',
    'CLAUDE.md': 'NOTES-ONLY',
    '.secret': 'HIDDEN',
    'css/.hidden': 'HIDDEN',
  })) {
    mkdirSync(dirname(join(ui, p)), { recursive: true });
    writeFileSync(join(ui, p), text);
  }
  writeFileSync(join(dir, 'secret.txt'), 'OUTSIDE-THE-UI-FOLDER');
  return ui;
}

test('web/ui is served as static files, at the root and under /ui/, with the right type, nosniff and the app CSP on every response', async () => {
  const dataDir = tempDir();
  const { base } = await startApp({ dataDir, uiDir: makeUi(dataDir) });
  const expectations = [
    ['/', 'start page', 'text/html; charset=utf-8'], ['/index.html', 'start page', 'text/html; charset=utf-8'], ['/ui/', 'start page', 'text/html; charset=utf-8'],
    ['/job.html?id=abc', 'Job', 'text/html; charset=utf-8'], ['/ui/job.html', 'Job', 'text/html; charset=utf-8'],
    ['/css/app.css', 'margin', 'text/css; charset=utf-8'], ['/ui/css/app.css', 'margin', 'text/css; charset=utf-8'],
    ['/js/api.mjs', 'export', 'text/javascript; charset=utf-8'], ['/img/logo.svg', '<svg', 'image/svg+xml'],
  ];
  for (const [path, contains, type] of expectations) {
    const res = await call(base, 'GET', path);
    assert.equal(res.status, 200, path);
    assert.ok(res.text.includes(contains), path);
    assert.equal(header(res, 'content-type'), type, path);
    assert.equal(header(res, 'content-security-policy'), APP_CSP, path);
    assert.equal(header(res, 'x-content-type-options'), 'nosniff', path);
    assert.equal(header(res, 'referrer-policy'), 'no-referrer', path);
    assert.equal(header(res, 'set-cookie'), null, path);
  }
  const head = await call(base, 'HEAD', '/index.html');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(header(head, 'content-security-policy'), APP_CSP);
  const missing = await call(base, 'GET', '/nope.html');
  assert.equal(missing.status, 404);
  assert.equal(header(missing, 'content-security-policy'), APP_CSP);
});

test('static files: other methods get 405, and dev, test, hidden and non-web files are never served', async () => {
  const dataDir = tempDir();
  const { base } = await startApp({ dataDir, uiDir: makeUi(dataDir) });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await call(base, method, '/index.html');
    assert.equal(res.status, 405, method);
    assert.equal(header(res, 'allow'), 'GET, HEAD');
  }
  for (const path of ['/dev/mock-server.mjs', '/ui/dev/mock-server.mjs', '/DEV/mock-server.mjs', '/test/a.test.mjs', '/Test/a.test.mjs', '/CLAUDE.md', '/.secret', '/css/.hidden', '/css/', '/img/', '/dev/']) {
    const res = await call(base, 'GET', path);
    assert.equal(res.status, 404, path);
    assert.ok(!/ONLY|HIDDEN|NOTES/.test(res.text), path);
  }
});

test('static files: path tricks never leave web/ui', async () => {
  const dataDir = tempDir();
  const { base } = await startApp({ dataDir, uiDir: makeUi(dataDir) });
  const paths = [
    '/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/css/../../secret.txt', '/css/%2e%2e/%2e%2e/secret.txt', '/ui/../secret.txt', '/ui/%2e%2e/secret.txt',
    '/..%5csecret.txt', '/css%5c..%5c..%5csecret.txt', '/css\\..\\..\\secret.txt', '/%00', '/index.html%00.png', '/c:/windows/win.ini', '/index.html::$DATA', '/css/app.css:x', '/con', '/css/nul.css', '/AUX.html', '/css/Com1.css',
    '//secret.txt', '//etc/passwd', '/%', '/%zz', '/css//app.css', '/.', '/./index.html', '/%2e/index.html', '/.git/config',
  ];
  for (const path of paths) {
    const res = await raw(base, 'GET', path);
    assert.ok([400, 404].includes(res.status), `${path} -> ${res.status}`);
    assert.ok(!res.text.includes('OUTSIDE-THE-UI-FOLDER'), path);
    assert.equal(res.headers['content-security-policy'], APP_CSP, path);
  }
});

test('static files: a link inside web/ui that points outside it is not followed', async (t) => {
  const dataDir = tempDir();
  const ui = makeUi(dataDir);
  const outside = join(dataDir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-THE-UI-FOLDER');
  try {
    symlinkSync(outside, join(ui, 'link'), 'junction');
  } catch (e) {
    return t.skip(`cannot create a link here: ${e.code}`);
  }
  const { base } = await startApp({ dataDir, uiDir: ui });
  const res = await call(base, 'GET', '/link/secret.txt');
  assert.equal(res.status, 404);
  assert.ok(!res.text.includes('OUTSIDE'));
});

test('the app CSP follows the configured viewer origin', async () => {
  const { base } = await startApp({ viewerOrigin: 'http://127.0.0.1:9999' });
  const csp = header(await call(base, 'GET', '/'), 'content-security-policy');
  assert.equal(csp, APP_CSP.replaceAll(VIEWER, 'http://127.0.0.1:9999'));
});

test('nodeNote warns when Node is older than .nvmrc and stays quiet otherwise or when it cannot tell', () => {
  assert.match(nodeNote('22.23.4', '24\n'), /Node 22.*Node 24.*\.nvmrc/);
  assert.equal(nodeNote('24.0.0', '24'), null);
  assert.equal(nodeNote('25.1.0', 'v24\n'), null);
  for (const wanted of [undefined, '', 'lts/*', 'garbage']) assert.equal(nodeNote('22.0.0', wanted), null);
});
