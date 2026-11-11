// Shared helpers of the web/server tests: the server on an ephemeral port with the fake orchestrator and a fake DNS lookup, request helpers,
// and the contract checks (by hand always, with ajv when contracts/node_modules exists). Every test file calls afterEach(cleanup).
// `node --test` also runs this file as a test file: it only defines things, so that counts as a pass.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../server.mjs';

export const here = dirname(fileURLToPath(import.meta.url));
export const FAKE = join(here, 'fake-orchestrator.mjs');
export const contracts = resolve(here, '../../../contracts');
export const VIEWER = 'http://127.0.0.1:8788';
export const fixture = (name) => JSON.parse(readFileSync(join(contracts, 'web/fixtures', name), 'utf8'));

// The contract is checked twice. checkByHand always runs, because web/ has no dependencies of its own and a machine may not have installed contracts/.
// When contracts/node_modules exists (npm ci in contracts/, which the web-server CI job does), every body is also validated against the real schemas with ajv.
let ajv = null;
export const hasAjv = () => ajv !== null;
try {
  const { default: Ajv2020 } = await import(pathToFileURL(join(contracts, 'node_modules/ajv/dist/2020.js')).href);
  ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const f of readdirSync(join(contracts, 'web/schemas'))) ajv.addSchema(JSON.parse(readFileSync(join(contracts, 'web/schemas', f), 'utf8')));
} catch {
  console.warn('contracts/node_modules is not installed: response bodies are checked by hand only. Run npm ci in contracts/ for the full schema check.');
}
const STAGE_NAMES = ['scout', 'story', 'art', 'council', 'select', 'build'];
export const RUN_ERRORS = Object.fromEntries(['site_blocked', 'quality_gate', 'budget', 'not_real', 'timeout', 'crash', 'server_restarted'].map((c) => [c, fixture(`job-failed-${c}.json`).error]));
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MANIFEST_URL = /^https?:\/\/[^/\s?#]+\/j\/[A-Za-z0-9_-]{22}\/manifest\.json$/;
const keysOf = (o, keys) => assert.deepEqual(Object.keys(o).sort(), [...keys].sort());

export function checkByHand(id, data) {
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

export function assertValid(id, data) {
  checkByHand(id, data);
  if (!ajv) return;
  const validate = ajv.getSchema(id);
  assert.ok(validate, `schema ${id} is not registered`);
  assert.ok(validate(data), `${id}: ${JSON.stringify(validate.errors)} in ${JSON.stringify(data)}`);
}
export const assertJob = (data) => assertValid('job.v1', data);
export const assertError = (res, code, status) => {
  assert.equal(res.status, status, `status for ${code}`);
  assertValid('error.v1', res.json);
  assert.deepEqual(res.json, fixture(`error-${code}.json`), `body for ${code} equals the contract fixture`);
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
export const alive = (pid) => {
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
export async function cleanup() {
  for (const app of apps.splice(0)) await app.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
export const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'web-server-test-'));
  dirs.push(d);
  return d;
};

// Invite store stand-ins (the real one is invites.mjs). allowAll accepts any non-empty code; oneUse also remembers who ran today.
export const allowAll = () => ({ check: (code) => (typeof code === 'string' && code !== '' ? { label: `label-${code}`, usedToday: false } : null), recordUse() {} });
export const oneUse = () => {
  const used = new Set();
  return { used, check: (code) => (typeof code === 'string' && code !== '' ? { label: `label-${code}`, usedToday: used.has(`label-${code}`) } : null), recordUse: (label) => used.add(label) };
};

export async function startApp(opts = {}) {
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

export async function call(base, method, path, body) {
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
export const post = (base, body) => call(base, 'POST', '/api/jobs', body);
export const getJob = (base, id) => call(base, 'GET', `/api/jobs/${id}`);

// The raw request line, untouched by any URL normalising (fetch would turn /../x into /x).
export function raw(base, method, path) {
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

export const site = (params = {}, host = 'school.example') => `https://${host}/?${new URLSearchParams(params)}`;
export const request = (over = {}) => ({ invite_code: 'K7M2PQ9XWD4R', url: site(), owner_name: 'Dana Whitfield', consent: true, ...over });
export const jobDir = (dataDir, id) => join(dataDir, 'jobs', id);
// The argument array the fake orchestrator was started with (it prints it into console.log).
export const argvOf = (dataDir, id) => {
  const line = readFileSync(join(jobDir(dataDir, id), 'console.log'), 'utf8').split('\n').find((l) => l.startsWith('FAKE-ARGV '));
  return JSON.parse(line.slice('FAKE-ARGV '.length));
};
export const finished = (base, id) => waitFor(async () => {
  const j = (await getJob(base, id)).json;
  return j.status === 'done' || j.status === 'failed' ? j : null;
}, `job ${id} to finish`);

// ---- the progress stream (GET /api/jobs/:id/events) ----

// The complete events and the comment lines of a text/event-stream body, the way a browser reads it: LF or CRLF line ends, lines that start with a colon are comments,
// an event is the lines up to a blank line, and a last event without its blank line is not an event yet. `data` is parsed JSON.
export function parseSse(text) {
  const events = [];
  const comments = [];
  const blocks = text.split(/\r?\n\r?\n/);
  if (!/\r?\n\r?\n$/.test(text)) blocks.pop();
  for (const block of blocks) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      if (line === '') continue;
      if (line.startsWith(':')) comments.push(line.slice(1).trim());
      else {
        const at = line.indexOf(':');
        fields[at < 0 ? line : line.slice(0, at)] = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
      }
    }
    if (fields.event !== undefined) events.push({ id: Number(fields.id), name: fields.event, data: JSON.parse(fields.data) });
  }
  return { events, comments };
}

// An open stream: whatever has arrived so far is in .text, and .ended says the server closed it.
export function openStream(base, id, headers = {}) {
  const abort = new AbortController();
  const stream = { text: '', ended: false, status: null, headers: null, error: null, close: () => abort.abort() };
  stream.ready = fetch(`${base}/api/jobs/${id}/events`, { headers, signal: abort.signal }).then(async (res) => {
    stream.status = res.status;
    stream.headers = res.headers;
    const decoder = new TextDecoder();
    for await (const chunk of res.body) stream.text += decoder.decode(chunk, { stream: true });
    stream.ended = true;
  }).catch((e) => {
    if (e.name !== 'AbortError') stream.error = e;
    stream.ended = true;
  });
  Object.defineProperties(stream, { events: { get: () => parseSse(stream.text).events }, comments: { get: () => parseSse(stream.text).comments } });
  return stream;
}
// The whole stream of a job that ends by itself.
export async function readStream(base, id, headers) {
  const stream = openStream(base, id, headers);
  await waitFor(() => stream.ended, `the stream of job ${id} to end`);
  if (stream.error) throw stream.error;
  return stream;
}
export const names = (events) => events.map((e) => (e.name === 'stage' ? `${e.data.stage}:${e.data.state}` : e.name === 'queued' ? `queued:${e.data.position}` : e.name));

// Events of a contract .sse fixture, or of a real stream, with the job id swapped for a placeholder and the ids kept: what is left must be equal.
export function normalised(events, jobId) {
  return JSON.parse(JSON.stringify(events.map(({ id, name, data }) => ({ id, name, data }))).split(jobId).join('<job>'));
}
export const sseFixture = (name) => parseSse(readFileSync(join(contracts, 'web/fixtures', name), 'utf8'));
export const FIXTURE_JOB = 'Xk3nP9qLm2VbT7sRw4YdHa';
