// Tests for GET /api/jobs/:id/events (plan/web-plan.md T43, contracts/web/README.md "Progress stream"): the whole history on connect, live events after it,
// Last-Event-ID, ': ping' comments, closing after done or failed, and the streams of the contract fixtures. The server runs for real on an ephemeral
// 127.0.0.1 port, the orchestrator is the fake, and streams are read with fetch. Streams are compared as parsed events (ids, names, data), never as raw text.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PING_MS } from '../progress.mjs';
import { VIEWER, RUN_ERRORS, assertError, assertValid, call, fixture, post, raw, request, site, jobDir, waitFor, startApp, finished, tempDir, cleanup, openStream, readStream, parseSse, names, normalised, sseFixture, FIXTURE_JOB } from './harness.mjs';

afterEach(cleanup);

const release = (dataDir, id, ...files) => files.forEach((f) => writeFileSync(join(jobDir(dataDir, id), f), ''));
const steps = (dataDir, id, from = 1, to = 6) => release(dataDir, id, ...Array.from({ length: to - from + 1 }, (_, i) => `step-${from + i}`));
const start = async (base, query, over = {}) => (await post(base, request({ url: site(query), ...over }))).json.job_id;

// ---- the streams of the contract fixtures ----

test('a successful run streams exactly events-done.sse: queued, started, every stage running then done, then done with the viewer manifest url, and the server closes the stream', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const id = await start(base, {});
  const stream = await readStream(base, id);
  assert.equal(stream.status, 200);
  assert.deepEqual(normalised(stream.events, id), normalised(sseFixture('events-done.sse').events, FIXTURE_JOB));
  assert.deepEqual(stream.events.map((e) => e.id), Array.from({ length: 15 }, (_, i) => i + 1), 'ids 1, 2, 3, ...');
  assert.equal(stream.events.at(-1).data.manifest_url, `http://127.0.0.1:8788/j/${id}/manifest.json`);
  assert.equal(stream.events.at(-1).data.manifest_url, `${VIEWER}/j/${id}/manifest.json`);
  assert.equal(stream.events.filter((e) => e.name === 'done' || e.name === 'failed').length, 1, 'exactly one terminal event');
  for (const e of stream.events) assertValid(`event.v1#/$defs/${e.name}`, e.data);
});

test('a run that fails at build streams exactly events-failed.sse: the building stage fails, then failed with the fixed quality_gate text', async () => {
  // upto 5: build died before it wrote anything. upto 6: build wrote 50-handoff.json (status fail) and then exited 3, which is what Lane C really does; its stage is still failed.
  for (const [query, pollMs] of [[{ exit: 3, upto: 5 }, 20], [{ exit: 3, upto: 6 }, 3600_000]]) {
    const { base } = await startApp({ pollMs });
    const id = await start(base, query);
    const stream = await readStream(base, id);
    assert.deepEqual(normalised(stream.events, id), normalised(sseFixture('events-failed.sse').events, FIXTURE_JOB), JSON.stringify(query));
    assert.deepEqual(stream.events.at(-1).data, RUN_ERRORS.quality_gate);
    for (const e of stream.events) assertValid(`event.v1#/$defs/${e.name}`, e.data);
    await cleanup();
  }
});

test('a job still waiting streams events-queued.sse as its place in line improves, and the stream stays open', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20 });
  const a = await start(base, { gate: 1 }, { invite_code: 'A' });
  const b = await start(base, { gate: 1 }, { invite_code: 'B' });
  const c = await start(base, { gate: 1 }, { invite_code: 'C' });
  const stream = openStream(base, c);
  await waitFor(() => stream.events.length >= 1, 'the first event');
  assert.deepEqual(stream.events.map((e) => e.data.position), [3]);
  release(dataDir, a, 'go');
  await waitFor(() => stream.events.length >= 2, 'the second event');
  release(dataDir, b, 'go');
  await waitFor(() => stream.events.length >= 5, 'queued 1, started and the scout stage');
  const expected = sseFixture('events-queued.sse').events;
  assert.deepEqual(normalised(stream.events.slice(0, expected.length), c), normalised(expected, FIXTURE_JOB), 'positions 3, 2, 1 like the fixture');
  assert.deepEqual(names(stream.events.slice(3, 5)), ['started', 'scout:running']);
  assert.equal(stream.ended, false, 'a stream that is not finished stays open');
  release(dataDir, c, 'go');
  await waitFor(() => stream.ended, 'the stream to close after the run');
  assert.equal(stream.events.at(-1).name, 'done');
});

// ---- the wire format ----

test('the response is an event stream with no caching, and each event is id, event and one compact data line, ended by a blank line (LF)', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const id = await start(base, {});
  const stream = await readStream(base, id);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(stream.headers.get('cache-control'), /no-store|no-cache/);
  assert.equal(stream.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!stream.headers.has('set-cookie'), 'no cookies');
  assert.ok(stream.text.startsWith('id: 1\nevent: queued\ndata: {"position":1}\n\n'), stream.text.slice(0, 80));
  assert.ok(stream.text.includes('id: 4\nevent: stage\ndata: {"stage":"scout","state":"done"}\n\n'));
  assert.ok(stream.text.endsWith('\n\n'));
  assert.ok(!stream.text.includes('\r'));
  const blocks = stream.text.trimEnd().split('\n\n');
  assert.equal(blocks.length, 15);
  for (const block of blocks) assert.match(block, /^id: \d+\nevent: [a-z]+\ndata: \{.*\}$/);
});

test('the ping interval is 15 seconds by default and injectable; a waiting stream gets a ": ping" comment line that no event parser sees', async () => {
  const dflt = await startApp();
  assert.equal(PING_MS, 15000);
  assert.equal(dflt.app.hub.pingMs, 15000);
  await cleanup();
  const { app, base } = await startApp({ pingMs: 40 });
  assert.equal(app.hub.pingMs, 40);
  const id = await start(base, { gate: 1 });
  const stream = openStream(base, id);
  await waitFor(() => (stream.text.match(/^: ping$/gm) ?? []).length >= 2, 'two pings');
  assert.match(stream.text, /\n\n: ping\n\n/, 'a comment on its own, between events');
  assert.deepEqual(parseSse(stream.text).comments.slice(0, 2), ['ping', 'ping']);
  assert.deepEqual(names(stream.events), ['queued:1', 'started', 'scout:running'], 'pings are not events');
  stream.close();
});

test('every event sent on one stream has an id one higher than the last, also across pings and when events arrive live', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20, pingMs: 30 });
  const id = await start(base, { steps: 1 });
  const stream = openStream(base, id);
  await waitFor(() => stream.events.length >= 3, 'the start');
  steps(dataDir, id, 1, 3);
  await waitFor(() => stream.events.length >= 9, 'three stages');
  steps(dataDir, id, 4, 6);
  await waitFor(() => stream.ended, 'the end');
  assert.deepEqual(stream.events.map((e) => e.id), Array.from({ length: stream.events.length }, (_, i) => i + 1));
  assert.equal(stream.events.length, 15);
});

// ---- history, live events and Last-Event-ID ----

test('a client that connects in the middle of a run gets the whole history from id 1, then the live events with the next ids', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20 });
  const id = await start(base, { steps: 1 });
  steps(dataDir, id, 1, 2);
  await waitFor(async () => (await call(base, 'GET', `/api/jobs/${id}`)).json.stages[1].state === 'done', 'story done');
  const late = openStream(base, id);
  await waitFor(() => late.events.length >= 7, 'the history');
  assert.deepEqual(names(late.events), ['queued:1', 'started', 'scout:running', 'scout:done', 'story:running', 'story:done', 'art:running']);
  assert.deepEqual(late.events.map((e) => e.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(late.ended, false);
  steps(dataDir, id, 3, 6);
  await waitFor(() => late.ended, 'the end');
  assert.deepEqual(normalised(late.events, id), normalised(sseFixture('events-done.sse').events, FIXTURE_JOB));
});

test('a reconnect with Last-Event-ID gets the full history again, then live events; a bad Last-Event-ID is ignored', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20 });
  const id = await start(base, { steps: 1 });
  const first = openStream(base, id);
  steps(dataDir, id, 1, 2);
  await waitFor(() => first.events.length >= 7, 'seven events');
  const last = first.events.at(-1).id;
  first.close(); // the tab lost its connection
  const reconnects = [openStream(base, id, { 'Last-Event-ID': String(last) }), openStream(base, id, { 'Last-Event-ID': 'abc' }), openStream(base, id, { 'Last-Event-ID': '9999' }), openStream(base, id, { 'Last-Event-ID': '-3' }), openStream(base, id, { 'Last-Event-ID': '' })];
  for (const stream of reconnects) await waitFor(() => stream.events.length >= 7, 'the history again');
  steps(dataDir, id, 3, 6);
  for (const stream of reconnects) {
    await waitFor(() => stream.ended, 'the end');
    assert.deepEqual(normalised(stream.events, id), normalised(sseFixture('events-done.sse').events, FIXTURE_JOB), 'full history from id 1, then the rest, ids unchanged');
  }
});

test('two clients on one job see the same events, and each one is cleaned up when it goes away', async () => {
  const { app, base, dataDir } = await startApp({ pollMs: 20 });
  const id = await start(base, { steps: 1 });
  const one = openStream(base, id);
  const two = openStream(base, id);
  await waitFor(() => one.events.length >= 3 && two.events.length >= 3, 'both streams');
  assert.equal(app.hub.open(), 2);
  one.close();
  await waitFor(() => app.hub.open() === 1, 'the closed stream to be forgotten');
  steps(dataDir, id);
  await waitFor(() => two.ended, 'the end');
  assert.equal(two.events.length, 15);
  assert.equal(app.hub.open(), 0, 'a stream that finished is forgotten');
  await finished(base, id);
});

test('a stream for a job that already finished replays everything and closes at once; the same for a failed one', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const ok = await start(base, {}, { invite_code: 'A' });
  const bad = await start(base, { exit: 4, upto: 1 }, { invite_code: 'B' });
  await finished(base, ok);
  await finished(base, bad);
  const done = await readStream(base, ok);
  assert.equal(done.events.length, 15);
  assert.equal(done.events.at(-1).name, 'done');
  const failed = await readStream(base, bad);
  assert.deepEqual(names(failed.events), ['queued:2', 'queued:1', 'started', 'scout:running', 'scout:done', 'story:running', 'story:failed', 'failed']);
  assert.deepEqual(failed.events.at(-1).data, RUN_ERRORS.budget);
});

test('a stub fallback run streams six finished stages and then failed with not_real, never done', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const id = await start(base, { stub: 1, noise: 1 });
  const stream = await readStream(base, id);
  assert.deepEqual(names(stream.events).slice(-3), ['build:running', 'build:done', 'failed']);
  assert.ok(!stream.events.some((e) => e.name === 'done'));
  assert.deepEqual(stream.events.at(-1).data, RUN_ERRORS.not_real);
  assert.ok(!/manifest|SECRET-|STUB|lane not present|Maple/.test(stream.text), 'nothing of the stand-in site or the log in the stream');
});

test('the failed message is the fixed contract text for every code and nothing the orchestrator printed is in the stream', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const cases = [[{ exit: 3 }, 'site_blocked'], [{ exit: 3, upto: 2 }, 'quality_gate'], [{ exit: 4 }, 'budget'], [{ exit: 1 }, 'crash'], [{ stub: 1 }, 'not_real']];
  for (const [i, [query, code]] of cases.entries()) {
    const id = await start(base, { ...query, noise: 1 }, { invite_code: `K${i}` });
    const stream = await readStream(base, id);
    assert.deepEqual(stream.events.at(-1), { id: stream.events.length, name: 'failed', data: RUN_ERRORS[code] }, code);
    assert.ok(!/SECRET-|FAKE-ARGV|FAILED stage/.test(stream.text), `${code}: no run output in the stream`);
  }
});

// ---- jobs the server did not run itself ----

test('after a restart the stream of a job the old server finished or lost is rebuilt from its record: a valid history that ends in done or failed', async () => {
  const dataDir = tempDir();
  const T = '2026-11-11T10:00:00.000Z';
  const stages = (...states) => ['scout', 'story', 'art', 'council', 'select', 'build'].map((stage, i) => ({ stage, state: states[i] ?? 'pending' }));
  const write = (id, patch) => {
    mkdirSync(join(dataDir, 'jobs', id), { recursive: true });
    writeFileSync(join(dataDir, 'jobs', id, 'job.json'), JSON.stringify({ ...fixture('job-queued.json'), job_id: id, ...patch, invite_label: 'x', url: 'https://school.example/', consent_note: 'n' }));
  };
  const finishedOk = 'doneJobDoneJobDoneJo03';
  write('queuedJobQueuedJobQu01', {});
  write('runningJobRunningJob02', { status: 'running', position: null, started_at: T, stages: stages('done', 'done', 'running') });
  write(finishedOk, { status: 'done', position: null, started_at: T, finished_at: T, stages: stages(...Array(6).fill('done')), manifest_url: `${VIEWER}/j/${finishedOk}/manifest.json` });
  const { base } = await startApp({ dataDir });
  const queued = await readStream(base, 'queuedJobQueuedJobQu01');
  assert.deepEqual(names(queued.events), ['queued:1', 'failed']);
  assert.deepEqual(queued.events.at(-1).data, RUN_ERRORS.server_restarted);
  const running = await readStream(base, 'runningJobRunningJob02');
  assert.deepEqual(names(running.events), ['queued:1', 'started', 'scout:running', 'scout:done', 'story:running', 'story:done', 'art:running', 'art:failed', 'failed']);
  assert.deepEqual(running.events.at(-1).data, RUN_ERRORS.server_restarted);
  const done = await readStream(base, finishedOk);
  assert.deepEqual(normalised(done.events, finishedOk), normalised(sseFixture('events-done.sse').events, FIXTURE_JOB));
  for (const stream of [queued, running, done]) {
    assert.deepEqual(stream.events.map((e) => e.id), stream.events.map((_, i) => i + 1));
    for (const e of stream.events) assertValid(`event.v1#/$defs/${e.name}`, e.data);
  }
});

// ---- what is not a stream ----

test('an unknown or malformed job id answers 404 not_found as JSON, not as a stream; other methods and paths under /api/ stay 404', async () => {
  const { base } = await startApp({ pollMs: 20 });
  const id = await start(base, {});
  for (const path of ['/api/jobs/Xk3nP9qLm2VbT7sRw4YdHa/events', '/api/jobs/short/events', '/api/jobs/__proto__/events', '/api/jobs/constructor/events', `/api/jobs/${id}x/events`, '/api/jobs//events', `/api/jobs/${id}/events/`, `/api/jobs/${id}/event`, `/api/jobs/${id}/events/1`]) {
    const res = await call(base, 'GET', path);
    assertError(res, 'not_found', 404);
    assert.match(res.headers.get('content-type'), /^application\/json/, path);
  }
  assertError(await call(base, 'POST', `/api/jobs/${id}/events`, {}), 'not_found', 404);
  assertError(await call(base, 'DELETE', `/api/jobs/${id}/events`), 'not_found', 404);
  assert.equal((await raw(base, 'GET', `/api/jobs/${id}/events/../../..`)).status, 404);
  assert.equal((await raw(base, 'HEAD', `/api/jobs/${id}/events`)).status, 404);
  const res = await fetch(`${base}/api/jobs/${id}/events?from=3`);
  assert.equal(res.status, 200, 'a query string is ignored');
  await res.body.cancel();
});

test('closing the server with streams still open does not hang and ends them', async () => {
  const { app, base } = await startApp({ pollMs: 20, pingMs: 20 });
  const id = await start(base, { gate: 1 });
  const stream = openStream(base, id);
  await waitFor(() => stream.events.length >= 3, 'the stream');
  const t0 = Date.now();
  await app.close();
  assert.ok(Date.now() - t0 < 8000);
  await waitFor(() => stream.ended, 'the stream to end');
  await waitFor(() => app.hub.open() === 0, 'the hub to forget the stream');
});
