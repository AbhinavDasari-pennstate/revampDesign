import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createMock, HTTP_STATUS, SCENARIOS, parseSse } from '../dev/mock-server.mjs';
import { fixture, fixtureText, errorFixtures } from './fixtures.js';

const JOB = 'Xk3nP9qLm2VbT7sRw4YdHa';
const GAP = 25;
let mock;
let uiDir;

beforeAll(async () => {
  uiDir = mkdtempSync(join(tmpdir(), 'web-ui-mock-'));
  mkdirSync(join(uiDir, 'assets'));
  writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>');
  writeFileSync(join(uiDir, 'assets', 'app.js'), 'console.log(1)');
  mock = await createMock({ appPort: 0, viewerPort: 0, uiDir, gapMs: GAP });
});
afterAll(async () => {
  await mock.close();
  rmSync(uiDir, { recursive: true, force: true });
});

const post = (path, body = fixture('start-request.json'), headers = {}) => fetch(`${mock.appUrl}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

// fetch() cleans dot segments (also %2e%2e) out of a URL before sending it, so traversal is tried with a raw request.
const rawStatus = (base, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: new URL(base).port, path }, (res) => {
    res.resume();
    resolve(res.statusCode);
  }).on('error', reject);
});

describe('mock app server', () => {
  it('listens on 127.0.0.1 only', () => {
    expect(new URL(mock.appUrl).hostname).toBe('127.0.0.1');
    expect(new URL(mock.viewerUrl).hostname).toBe('127.0.0.1');
  });

  it('serves the built UI with the app CSP, for / and for /?job=<id>', async () => {
    for (const path of ['/', `/?job=${JOB}`, '/index.html']) {
      const res = await fetch(`${mock.appUrl}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
      expect(res.headers.get('referrer-policy'), 'the ?fail switch needs the page URL as Referer').toBeNull();
      expect(await res.text()).toContain('id="root"');
    }
    const js = await fetch(`${mock.appUrl}/assets/app.js`);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`${mock.appUrl}/nope.html`)).status).toBe(404);
    // Plain and %2e%2e dot segments are resolved inside the root by the URL parser; encoded slashes are refused.
    for (const path of ['/../package.json', '/../../web/ui/package.json', '/assets/..%2f..%2fpackage.json', '/assets%5c..%5c..%5cpackage.json']) {
      expect(await rawStatus(mock.appUrl, path), path).toBe(404);
    }
  });

  it('answers POST /api/jobs with the queued job fixture', async () => {
    const res = await post('/api/jobs');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(fixture('job-queued.json'));
  });

  it('answers with every error fixture and its HTTP status through ?fail=<code>, also when the page URL carries it', async () => {
    for (const [code, body] of errorFixtures()) {
      const res = await post(`/api/jobs?fail=${code}`);
      expect(res.status, code).toBe(HTTP_STATUS[code]);
      expect(await res.json()).toEqual(body);
      const fromPage = await post('/api/jobs', undefined, { referer: `${mock.appUrl}/?fail=${code}` });
      expect(fromPage.status, code).toBe(HTTP_STATUS[code]);
    }
    expect(HTTP_STATUS).toMatchObject({ bad_request: 400, invite_invalid: 403, invite_used_today: 429, queue_full: 503, not_found: 404 });
  });

  it('answers any other /api path with not_found', async () => {
    const res = await fetch(`${mock.appUrl}/api/whatever`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(fixture('error-not_found.json'));
  });
});

describe('mock viewer', () => {
  const run = (path) => fetch(`${mock.viewerUrl}/j/${JOB}/run/${path}`);

  it('serves the sample run under the viewer layout with the sandbox CSP', async () => {
    const page = await run('c-build/site/dist/index.html');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(page.headers.get('content-security-policy')).toMatch(/sandbox allow-scripts/);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    for (const path of ['c-build/screens/home-desktop.png', 'b-design/compare.html', 'b-design/previews/d1-desktop.png', 'b-design/boards/d1.html']) {
      expect((await run(path)).status, path).toBe(200);
    }
  });

  it('serves nothing outside the allowed folders', async () => {
    for (const path of ['10-inventory.json', '50-handoff.json', 'a-scout/screens/p01-desktop.png', 'c-build/axe.json', 'c-build/site/dist/']) {
      expect((await run(path)).status, path).toBe(404);
    }
    for (const path of ['c-build/site/dist/../../../00-run.json', 'c-build/site/dist/%2e%2e/%2e%2e/report.md', 'c-build/screens/..%2f..%2f10-inventory.json', 'c-build/screens/..%5c..%5c10-inventory.json']) {
      expect(await rawStatus(mock.viewerUrl, `/j/${JOB}/run/${path}`), path).toBe(404);
    }
    expect((await fetch(`${mock.viewerUrl}/j/not-a-job/run/c-build/site/dist/index.html`)).status).toBe(404);
  });
});

describe('mock progress stream', () => {
  const FAILED = Object.keys(SCENARIOS).find((id) => SCENARIOS[id] === 'events-failed.sse');
  const QUEUED = Object.keys(SCENARIOS).find((id) => SCENARIOS[id] === 'events-queued.sse');
  const readStream = async (id, headers = {}) => {
    const t0 = Date.now();
    const res = await fetch(`${mock.appUrl}/api/jobs/${id}/events`, { headers });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    return { events: parseSse(await res.text()), ms: Date.now() - t0 };
  };

  it('has one job id per fixture stream, the done one being the contract job id', () => {
    expect(SCENARIOS[JOB]).toBe('events-done.sse');
    expect(Object.values(SCENARIOS).sort()).toEqual(['events-done.sse', 'events-failed.sse', 'events-queued.sse']);
    for (const id of Object.keys(SCENARIOS)) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('POST picks the run through ?run=done|failed|queued, from the POST or the page URL', async () => {
    expect((await (await post('/api/jobs?run=failed')).json()).job_id).toBe(FAILED);
    expect((await (await post('/api/jobs', undefined, { referer: `${mock.appUrl}/?run=queued` })).json()).job_id).toBe(QUEUED);
    expect((await (await post('/api/jobs')).json()).job_id).toBe(JOB);
  });

  it('replays events-done.sse one event per gap and then closes', async () => {
    await post('/api/jobs'); // a POST starts the run's clock again
    const { events, ms } = await readStream(JOB);
    expect(events).toEqual(parseSse(fixtureText('events-done.sse')));
    expect(ms).toBeGreaterThanOrEqual(GAP * 13);
    const job = await (await fetch(`${mock.appUrl}/api/jobs/${JOB}`)).json();
    expect(job).toEqual(fixture('job-done.json'));
  });

  it('replays events-failed.sse and the job ends as the quality_gate fixture', async () => {
    await post('/api/jobs?run=failed');
    const { events } = await readStream(FAILED);
    expect(events).toEqual(parseSse(fixtureText('events-failed.sse')));
    const job = await (await fetch(`${mock.appUrl}/api/jobs/${FAILED}`)).json();
    expect(job).toEqual({ ...fixture('job-failed-quality_gate.json'), job_id: FAILED });
  });

  it('answers a reconnect with Last-Event-ID with the whole history from id 1, as the contract says', async () => {
    const { events, ms } = await readStream(JOB, { 'last-event-id': '9' });
    expect(events.map((e) => e.id)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(ms).toBeLessThan(GAP * 10); // the run is over, so the history comes at once
  });

  it('keeps a queued stream open after its last event, and the job shows its place', async () => {
    await post('/api/jobs?run=queued');
    const controller = new AbortController();
    const res = await fetch(`${mock.appUrl}/api/jobs/${QUEUED}/events`, { signal: controller.signal });
    const reader = res.body.getReader();
    let text = '';
    let pending = reader.read(); // kept across rounds, so a chunk that lands after a timeout is not lost
    const until = Date.now() + GAP * 8;
    while (Date.now() < until) {
      const next = await Promise.race([pending, new Promise((r) => setTimeout(() => r({ timeout: true }), GAP))]);
      if (next.timeout) continue;
      if (next.done) throw new Error('queued stream closed');
      text += new TextDecoder().decode(next.value);
      pending = reader.read();
    }
    controller.abort();
    expect(parseSse(text).map((e) => e.data.position)).toEqual([3, 2, 1]);
    const job = await (await fetch(`${mock.appUrl}/api/jobs/${QUEUED}`)).json();
    expect(job).toMatchObject({ job_id: QUEUED, status: 'queued', position: 1 });
  });

  it('answers an unknown job with not_found as JSON, never a stream', async () => {
    for (const path of ['/api/jobs/AAAAAAAAAAAAAAAAAAAAAA', '/api/jobs/AAAAAAAAAAAAAAAAAAAAAA/events', '/api/jobs/short/events']) {
      const res = await fetch(`${mock.appUrl}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual(fixture('error-not_found.json'));
    }
  });
});
