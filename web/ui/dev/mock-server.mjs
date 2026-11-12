#!/usr/bin/env node
// Fixture mock of the two servers the UI talks to, so web/ui/ is built and tested without web/server/ or web/viewer/.
// Answers come only from the frozen contract fixtures (contracts/web/fixtures/, tag contracts-web-v1.0.0) and the
// sample run (contracts/fixtures/sample/). Node stdlib only.
//
//   node dev/mock-server.mjs        app on http://127.0.0.1:8787 (dist/ plus /api), viewer on http://127.0.0.1:8788
//
// App: serves the built UI from dist/ with the same CSP as the real server, and POST /api/jobs answers with
// job-queued.json. ?fail=<code> on the POST, or on the page that posts it (http://127.0.0.1:8787/?fail=queue_full),
// answers with error-<code>.json and the contract's HTTP status instead. ?run=done|failed|queued the same way picks
// which fixture stream the new job plays (default done). GET /api/jobs/<id> and /events follow that stream, one event
// every gapMs (1 s) from the POST; the job ids are in SCENARIOS, so http://127.0.0.1:8787/?job=<id> works without a POST.
// Viewer: GET /j/<job_id>/run/<path> serves the sample run, only under the folders the contract allows.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const FIXTURES = join(repoRoot, 'contracts', 'web', 'fixtures');
const SAMPLE = join(repoRoot, 'contracts', 'fixtures', 'sample');
const DEV_ORIGIN = 'http://127.0.0.1:5173'; // npm run dev (vite.config.js)

// HTTP status per error.v1 code (contracts/web/README.md, "Error codes and their fixed text").
export const HTTP_STATUS = Object.freeze({
  bad_request: 400, bad_url: 400, host_not_public: 400, owner_name_required: 400, consent_required: 400,
  invite_invalid: 403, invite_used_today: 429, daily_cap_reached: 503, queue_full: 503, not_found: 404,
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8',
};
const VIEWER_ALLOWED = ['c-build/site/dist/', 'c-build/screens/', 'b-design/compare.html', 'b-design/previews/', 'b-design/boards/'];
const JOB_ID = /^[A-Za-z0-9_-]{22}$/;

// One job id per fixture stream. The done run uses the contract's own job id, so job-done.json and manifest.json fit it.
export const SCENARIOS = Object.freeze({
  Xk3nP9qLm2VbT7sRw4YdHa: 'events-done.sse',
  MockFailedRunQualGate0: 'events-failed.sse',
  MockQueuedRunWaiting00: 'events-queued.sse',
});
const JOB_OF_RUN = Object.fromEntries(Object.entries(SCENARIOS).map(([id, file]) => [file.slice('events-'.length, -'.sse'.length), id]));

// An event stream as [{id, name, data}]: LF or CRLF line ends, comment lines skipped (contracts/web/README.md).
export function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const event = {};
    for (const line of block.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue;
      const at = line.indexOf(':');
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
      if (field === 'id') event.id = Number(value);
      else if (field === 'event') event.name = value;
      else if (field === 'data') event.data = JSON.parse(value);
    }
    if (event.name) events.push(event);
  }
  return events;
}
const formatEvent = ({ id, name, data }) => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const fixture = async (name) => JSON.parse(await readFile(join(FIXTURES, name), 'utf8'));
const streamOf = async (id) => parseSse(await readFile(join(FIXTURES, SCENARIOS[id]), 'utf8'));

// job.v1 after the given events, built from the contract's job fixtures.
async function jobAfter(id, events) {
  let job = { ...(await fixture('job-queued.json')), job_id: id };
  for (const { name, data } of events) {
    if (name === 'queued') job.position = data.position;
    if (name === 'started') job = { ...job, status: 'running', position: null, mode: data.mode, started_at: (await fixture('job-running.json')).started_at };
    if (name === 'stage') job.stages = job.stages.map((s) => (s.stage === data.stage ? { ...s, state: data.state } : s));
    if (name === 'done') return { ...(await fixture('job-done.json')), job_id: id };
    if (name === 'failed') return { ...(await fixture('job-failed-quality_gate.json')), job_id: id };
  }
  return job;
}

// URL path to decoded segments, or null when any segment is empty, a dot segment, or holds a slash, backslash or NUL.
function segmentsOf(path) {
  const parts = path.split('/');
  const out = [];
  for (const part of parts) {
    let s;
    try {
      s = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (s === '' || s === '.' || s === '..' || /[/\\\0]/.test(s)) return null;
    out.push(s);
  }
  return out;
}

// The real path of a plain file under root, or null.
async function fileUnder(root, segments) {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(join(root, ...segments));
    if (!real.startsWith(realRoot + sep) || !(await stat(real)).isFile() || !Object.hasOwn(MIME, extname(real).toLowerCase())) return null;
    return real;
  } catch {
    return null;
  }
}

const fromReferer = (req, name) => {
  try {
    return new URL(req.headers.referer).searchParams.get(name);
  } catch {
    return null;
  }
};

const drain = (req) => new Promise((resolve) => {
  req.on('data', () => {});
  req.on('end', resolve);
  req.on('error', resolve);
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

export async function createMock({ appPort = 8787, viewerPort = 8788, uiDir = join(here, '..', 'dist'), gapMs = 1000 } = {}) {
  const app = http.createServer();
  const viewer = http.createServer();
  const realViewerPort = await listen(viewer, viewerPort);
  const realAppPort = await listen(app, appPort);
  const appUrl = `http://127.0.0.1:${realAppPort}`;
  const viewerUrl = `http://127.0.0.1:${realViewerPort}`;
  const appOrigins = [appUrl, DEV_ORIGIN];

  // The real server's app CSP (plan/web-plan.md T40), so a build that breaks it breaks here first.
  const appCsp = [
    "default-src 'self'", `frame-src 'self' ${viewerUrl}`, `img-src 'self' ${viewerUrl}`, `connect-src 'self' ${viewerUrl}`,
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join('; ');
  const viewerCsp = `sandbox allow-scripts; connect-src 'none'; form-action 'none'; frame-ancestors ${appOrigins.join(' ')}`;
  // Unlike the real server, app pages carry no Referrer-Policy: the browser must send the page URL with the POST for
  // the ?fail=<code> switch to work. Viewer files keep no-referrer, as the plan asks of the real viewer.
  const common = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
  const viewerHeaders = { 'content-security-policy': viewerCsp, 'referrer-policy': 'no-referrer' };

  const sendJson = (res, status, body) => {
    res.writeHead(status, { ...common, 'content-type': MIME['.json'] });
    res.end(JSON.stringify(body));
  };
  const sendError = async (res, code) => sendJson(res, HTTP_STATUS[code], await fixture(`error-${code}.json`));
  const sendText = (res, status, text, headers = {}) => {
    res.writeHead(status, { ...common, 'content-type': MIME['.md'], ...headers });
    res.end(text);
  };
  const sendFile = async (req, res, file, headers) => {
    const body = await readFile(file);
    res.writeHead(200, { ...common, 'content-type': MIME[extname(file).toLowerCase()], 'content-length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  // When each job's run began (its POST, or the first request that named it). Event i happens i * gapMs later.
  const startedAt = new Map();
  const startOf = (id) => {
    if (!startedAt.has(id)) startedAt.set(id, Date.now());
    return startedAt.get(id);
  };
  const happened = (id, events) => events.slice(0, Math.min(events.length, Math.floor((Date.now() - startOf(id)) / gapMs) + 1));

  // Like the real server: the whole history from id 1 on every connect (Last-Event-ID too), then each event on time,
  // a ping every 15 s, and the end of the stream after done or failed. A queued stream stays open.
  function sendStream(req, res, id, events) {
    res.writeHead(200, { ...common, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    const t0 = startOf(id);
    const now = Date.now();
    const timers = events.map((event, i) => setTimeout(() => {
      res.write(formatEvent(event));
      if (event.name === 'done' || event.name === 'failed') res.end();
    }, Math.max(0, t0 + i * gapMs - now)));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      timers.forEach(clearTimeout);
      clearInterval(ping);
    });
  }

  async function api(req, res, url) {
    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      await drain(req);
      const fail = url.searchParams.get('fail') ?? fromReferer(req, 'fail');
      if (fail !== null) return sendError(res, Object.hasOwn(HTTP_STATUS, fail) ? fail : 'bad_request');
      const run = url.searchParams.get('run') ?? fromReferer(req, 'run');
      const id = JOB_OF_RUN[run] ?? JOB_OF_RUN.done;
      startedAt.set(id, Date.now());
      return sendJson(res, 202, { ...(await fixture('job-queued.json')), job_id: id });
    }
    const m = /^\/api\/jobs\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (req.method === 'GET' && m && Object.hasOwn(SCENARIOS, m[1])) {
      const events = await streamOf(m[1]);
      if (m[2]) return sendStream(req, res, m[1], events);
      return sendJson(res, 200, await jobAfter(m[1], happened(m[1], events)));
    }
    return sendError(res, 'not_found');
  }

  async function onApp(req, res) {
    const url = new URL(req.url, appUrl);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    const segments = url.pathname === '/' ? ['index.html'] : segmentsOf(url.pathname.slice(1));
    const file = segments && await fileUnder(uiDir, segments);
    if (file) return sendFile(req, res, file, { 'content-security-policy': appCsp });
    if (url.pathname === '/') return sendText(res, 404, 'No build yet: run npm run build, or use npm run dev and open http://127.0.0.1:5173/');
    return sendText(res, 404, 'Not found');
  }

  async function onViewer(req, res) {
    const url = new URL(req.url, viewerUrl);
    const m = /^\/j\/([^/]+)\/(.*)$/.exec(url.pathname);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !m || !JOB_ID.test(m[1])) return sendText(res, 404, 'Not found');
    const rest = m[2];
    if (rest.startsWith('run/')) {
      const segments = segmentsOf(rest.slice('run/'.length));
      const path = segments && segments.join('/');
      const allowed = path && VIEWER_ALLOWED.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
      const file = allowed && await fileUnder(SAMPLE, segments);
      if (file) return sendFile(req, res, file, viewerHeaders);
    }
    return sendText(res, 404, 'Not found');
  }

  const guard = (handler) => (req, res) => handler(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendText(res, 500, 'Mock server error');
    else res.destroy();
  });
  app.on('request', guard(onApp));
  viewer.on('request', guard(onViewer));

  const close = () => Promise.all([app, viewer].map((s) => new Promise((resolve) => {
    s.closeAllConnections();
    s.close(resolve);
  })));
  return { appUrl, viewerUrl, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await createMock();
  console.log(`mock app    ${mock.appUrl}/  (serves dist/: run npm run build first, or npm run dev for http://127.0.0.1:5173/)`);
  console.log(`mock viewer ${mock.viewerUrl}/j/<job_id>/run/...`);
  console.log(`errors      ${mock.appUrl}/?fail=<code>, for example ?fail=invite_used_today`);
  console.log(`runs        ${mock.appUrl}/?run=done|failed|queued, or open a job: ${Object.keys(SCENARIOS).map((id) => `?job=${id}`).join(' ')}`);
}
