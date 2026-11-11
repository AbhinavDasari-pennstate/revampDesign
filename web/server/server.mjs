// The tester app server (plan/web-plan.md T40). Node stdlib only; listens on 127.0.0.1 only.
//   node web/server/server.mjs [--port 8787] [--data-dir web-data] [--orchestrator orchestrator/cli.mjs] [--timeout-min 45] [--allow-local]
// Routes: POST /api/jobs, GET /api/jobs/:job_id (contracts/web/README.md); everything else under /api/ is 404 not_found; every other GET and HEAD is a
// static file of web/ui/ (at the root and under /ui/), read as a file and never executed. The viewer (results, sandboxed) is a separate server.
// The invite store is injected (createApp option `invites`, built by T47). With none, every start request is refused as invite_invalid.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { API_ERRORS } from './messages.mjs';
import { JobQueue, isJobId } from './queue.mjs';
import { checkHost, parseTarget } from './urlcheck.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const MAX_BODY = 4096;
const FIELDS = new Set(['invite_code', 'url', 'owner_name', 'consent']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const NOT_SERVED = new Set(['dev', 'test']); // top level folders of web/ui/ that are tools, not pages
const PLACEHOLDER = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tester app</title></head><body><h1>Tester app</h1><p>The tester page is not installed yet. The job API is running at /api/jobs.</p></body></html>';

// Warns when the running Node is older than .nvmrc (Lane C's build needs 24). A warning, never a stop. Returns null when fine or unreadable.
export function nodeNote(version, wanted) {
  const [have, want] = [parseInt(version, 10), parseInt(String(wanted ?? '').trim().replace(/^v/, ''), 10)];
  return have < want ? `Warning: running on Node ${have}, the project needs Node ${want} (.nvmrc). Lane C's build may fail.` : null;
}

// Owner name as it goes into the consent note: line breaks and tabs become spaces, other control characters are dropped, runs of spaces
// collapse. Capped at 100 code points (the same unit as [...s].length, so an emoji counts once).
function cleanName(name) {
  const text = name.replace(/[\u2028\u2029\t\n\r\f\v]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, 100).join('').trim();
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => resolveBody(over ? { tooLarge: true } : { buffer: Buffer.concat(chunks) }));
    req.on('error', reject);
  });
}

// options: dataDir, orchestrator, uiDir (all absolute paths, defaults under the repo), invites { check(code), recordUse(label) }, lookup (DNS, for tests),
// allowLocal, timeoutMs, maxLine, viewerOrigin, log ({ log, error }), now.
export function createApp({
  dataDir = join(repoRoot, 'web-data'), orchestrator = join(repoRoot, 'orchestrator', 'cli.mjs'), uiDir = join(here, '..', 'ui'), invites, lookup, allowLocal = false,
  timeoutMs = 45 * 60_000, maxLine = 5, viewerOrigin = 'http://127.0.0.1:8788', log = console, now = () => new Date(),
} = {}) {
  if (invites && (typeof invites.check !== 'function' || typeof invites.recordUse !== 'function')) throw new TypeError('invites needs check(code) and recordUse(label)');
  const queue = new JobQueue({ dataDir, orchestrator, timeoutMs, maxLine, viewerOrigin, log, now });
  const appCsp = [
    "default-src 'self'", `frame-src 'self' ${viewerOrigin}`, `img-src 'self' ${viewerOrigin}`, `connect-src 'self' ${viewerOrigin}`,
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join('; ');
  const baseHeaders = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

  const send = (res, status, headers, body) => {
    res.writeHead(status, { ...baseHeaders, ...headers });
    res.end(body);
  };
  const sendJson = (res, status, data) => send(res, status, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify(data));
  const sendError = (res, code) => {
    const [status, message] = API_ERRORS[code];
    sendJson(res, status, { error: { code, message } });
  };

  // Rules 5 and 6: is the code known, and has it not started a run today. No store wired in means no code is ever valid.
  const inviteGate = (code) => {
    const found = invites ? invites.check(code) : null;
    if (!found) return { code: 'invite_invalid' };
    if (found.usedToday) return { code: 'invite_used_today' };
    return { label: found.label };
  };

  // POST /api/jobs: the checks run in the order of contracts/web/README.md, and the first failure answers.
  async function startJob(req, res) {
    const read = await readBody(req);
    if (read.tooLarge) return sendError(res, 'bad_request'); // 1
    let body;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
    } catch {
      return sendError(res, 'bad_request');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 'bad_request');
    if (Object.keys(body).some((k) => !FIELDS.has(k))) return sendError(res, 'bad_request');
    if (typeof body.owner_name === 'string' && [...body.owner_name].length > 200) return sendError(res, 'bad_request');

    const target = parseTarget(body.url); // 2
    if (!target.ok) return sendError(res, 'bad_url');
    const ownerName = typeof body.owner_name === 'string' ? cleanName(body.owner_name) : ''; // 3
    if (ownerName === '') return sendError(res, 'owner_name_required');
    if (body.consent !== true) return sendError(res, 'consent_required'); // 4

    const first = inviteGate(body.invite_code); // 5 and 6, before any DNS lookup so a caller without a code cannot make us resolve names
    if (first.code) return sendError(res, first.code);
    const host = await checkHost(target.url.hostname, { lookup, allowLocal }); // 8
    if (!host.ok) return sendError(res, host.code);

    // The lookup was a pause: another request may have used the code meanwhile, so ask again right before accepting.
    const gate = inviteGate(body.invite_code);
    if (gate.code) return sendError(res, gate.code);
    if (queue.isFull()) return sendError(res, 'queue_full'); // 9

    const when = now();
    const consentNote = `Owner ${ownerName} confirmed consent in the tester app at ${when.toISOString()}`;
    invites.recordUse(gate.label);
    const job = queue.add({ url: target.url.href, consentNote, inviteLabel: gate.label, createdAt: when });
    sendJson(res, 202, queue.view(job));
  }

  async function api(req, res, path) {
    if (req.method === 'POST' && path === '/api/jobs') return startJob(req, res);
    const m = req.method === 'GET' ? /^\/api\/jobs\/([^/]+)$/.exec(path) : null;
    const job = m && isJobId(m[1]) ? queue.get(m[1]) : undefined;
    if (job) return sendJson(res, 200, queue.view(job));
    return sendError(res, 'not_found');
  }

  // ---- static files of web/ui/ ----

  const staticHeaders = (type) => ({ 'content-type': type, 'content-security-policy': appCsp });
  const sendStatic = (req, res, status, type, body) => {
    res.writeHead(status, { ...baseHeaders, ...staticHeaders(type), 'content-length': Buffer.byteLength(body) });
    res.end(body); // Node sends no body for HEAD
  };
  const notFound = (req, res) => sendStatic(req, res, 404, 'text/plain; charset=utf-8', 'Not found');

  // The URL path as safe segments, or null. Each segment is decoded alone, so %2f never becomes a separator, and anything that could
  // climb, hide, name a drive or a device is refused. A trailing slash is returned as dir: true.
  function segmentsOf(path) {
    const parts = path.split('/');
    parts.shift(); // the empty piece before the leading slash
    const dir = parts[parts.length - 1] === '';
    if (dir) parts.pop();
    const out = [];
    for (const part of parts) {
      let s;
      try {
        s = decodeURIComponent(part);
      } catch {
        return null;
      }
      if (s === '' || s.startsWith('.') || /[\\/:\u0000-\u001f]/.test(s)) return null;
      out.push(s);
    }
    if (out[0] === 'ui') out.shift();
    return { segments: out, dir };
  }

  async function fileFor({ segments, dir }) {
    try {
      const root = await realpath(uiDir);
      const wanted = join(root, ...segments, ...(dir || segments.length === 0 ? ['index.html'] : []));
      const real = await realpath(wanted);
      // real is canonical (case and 8.3 short names resolved by the OS), so the dev and test check cannot be dodged by spelling
      if (!real.startsWith(root + sep) || NOT_SERVED.has(real.slice(root.length + 1).split(sep)[0])) return null;
      if (!(await stat(real)).isFile() || !Object.hasOwn(MIME, extname(real).toLowerCase())) return null;
      return real;
    } catch {
      return null;
    }
  }

  async function serveStatic(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': appCsp }, 'Method not allowed');
    const parsed = segmentsOf(path);
    if (!parsed) return notFound(req, res);
    const file = await fileFor(parsed);
    if (file) return sendStatic(req, res, 200, MIME[extname(file).toLowerCase()], await readFile(file));
    const isRootPage = parsed.segments.length === 0 || (parsed.segments.length === 1 && parsed.segments[0] === 'index.html' && !parsed.dir);
    if (isRootPage) return sendStatic(req, res, 200, MIME['.html'], PLACEHOLDER);
    return notFound(req, res);
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('#')[0].split('?')[0];
    const run = path === '/api' || path.startsWith('/api/') ? api(req, res, path) : serveStatic(req, res, path);
    run.catch((e) => {
      log.error?.(`request failed: ${e?.stack ?? e}`); // never sent to the client
      if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, 'Internal error');
      else res.destroy();
    });
  });

  const app = {
    server, queue, port: null,
    // Always 127.0.0.1: there is deliberately no way to choose another address.
    listen: (port) => new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        app.port = server.address().port;
        resolveListen(app.port);
      });
    }),
    close: async () => {
      await queue.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
  return app;
}

// ---- command line ----

async function main() {
  const { values } = parseArgs({
    options: { port: { type: 'string' }, 'data-dir': { type: 'string' }, orchestrator: { type: 'string' }, 'timeout-min': { type: 'string' }, 'allow-local': { type: 'boolean' } },
  });
  const usage = (text) => {
    console.error(`${text}\nusage: node web/server/server.mjs [--port 8787] [--data-dir web-data] [--orchestrator orchestrator/cli.mjs] [--timeout-min 45] [--allow-local]`);
    process.exit(2);
  };
  const port = values.port === undefined ? 8787 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage(`--port must be a whole number from 0 to 65535, got ${values.port}`);
  const timeoutMin = values['timeout-min'] === undefined ? 45 : Number(values['timeout-min']);
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) usage(`--timeout-min must be a number above 0, got ${values['timeout-min']}`);
  const abs = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));
  const orchestrator = values.orchestrator ? abs(values.orchestrator) : join(repoRoot, 'orchestrator', 'cli.mjs');
  if (!existsSync(orchestrator)) usage(`the orchestrator script does not exist: ${orchestrator}`);

  let wanted;
  try {
    wanted = readFileSync(join(repoRoot, '.nvmrc'), 'utf8');
  } catch {}
  const note = nodeNote(process.versions.node, wanted);
  if (note) console.error(note);

  const uiDir = join(here, '..', 'ui');
  const app = createApp({ dataDir: values['data-dir'] ? abs(values['data-dir']) : join(repoRoot, 'web-data'), orchestrator, uiDir, allowLocal: values['allow-local'], timeoutMs: Math.round(timeoutMin * 60_000) });
  await app.listen(port);
  console.log(`Tester app server listening on http://127.0.0.1:${app.port}`);
  if (!existsSync(join(uiDir, 'index.html'))) console.log('web/ui/ has no index.html yet: serving the placeholder page.');
  console.log('No invite store is wired in yet (task T47): every start request is refused as invite_invalid.');
  if (values['allow-local']) console.error('WARNING: --allow-local is on. Private and local addresses are accepted as targets. Use it only on your own machine.');
  const stop = () => app.close().finally(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Run as a program (not when a test imports this file). Windows drive letters can differ in case between the two paths.
const sameFile = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && sameFile(resolve(process.argv[1]), fileURLToPath(import.meta.url))) await main();
