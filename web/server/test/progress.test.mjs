// Tests for live progress (plan/web-plan.md T43): stages from the contract files that appear in the run folder, how an exit is classified (site_blocked,
// quality_gate, budget, not_real, crash, timeout), the fixed failure texts, and the viewer child process. The orchestrator is test/fake-orchestrator.mjs
// (never a real crawl, never --live, never a paid model); its ?steps=1 switch releases one contract file per test step, so no test races the 1 s poller.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { STAGES, STAGE_FILES, POLL_MS, PING_MS, classifyExit, failedStage, runDirOf, stagesDone, wasStubbed } from '../progress.mjs';
import { startViewer } from '../server.mjs';
import { VIEWER, FAKE, here, RUN_ERRORS, assertJob, assertValid, alive, getJob, post, request, site, sleep, jobDir, waitFor, startApp, finished, tempDir, cleanup, names, readStream, sseFixture, FIXTURE_JOB } from './harness.mjs';

afterEach(cleanup);

const writeStage = (dir, i, text = '{}') => writeFileSync(join(dir, STAGE_FILES[i]), text);
const stateList = (job) => job.stages.map((s) => s.state);
const stageStates = (...states) => STAGES.map((_, i) => states[i] ?? 'pending');
// Start recording before the first POST (the queued event is sent inside it); the result gives the events of one job as { name, data }, in order.
function record(app) {
  const all = [];
  app.queue.on('event', (jobId, name, data) => all.push({ jobId, name, data }));
  return (id) => all.filter((e) => e.jobId === id).map(({ name, data }) => ({ name, data }));
}

// ---- the pure pieces ----

test('the stage table follows the orchestrator: six stages in order, each with the contract file it produces', () => {
  assert.deepEqual(STAGES, ['scout', 'story', 'art', 'council', 'select', 'build']);
  assert.deepEqual(STAGE_FILES, ['10-inventory.json', '20-storyboard.json', '30-directions.json', '40-verdict.json', '45-selection.json', '50-handoff.json']);
  assert.equal(POLL_MS, 1000);
  assert.equal(PING_MS, 15000);
});

test('classifyExit: exit 3 at scout is site_blocked, exit 3 later quality_gate, exit 4 budget, a stub run not_real, a killed run timeout, anything else non zero crash', () => {
  const run = (over) => classifyExit({ code: 0, timedOut: false, stagesDone: 6, stubbed: false, ...over });
  assert.equal(run({}), null, 'a real run that wrote everything is a success');
  assert.equal(run({ code: 3, stagesDone: 0 }), 'site_blocked');
  for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(run({ code: 3, stagesDone: n }), 'quality_gate', `exit 3 with ${n} stages done`);
  for (const n of [0, 1, 3, 6]) assert.equal(run({ code: 4, stagesDone: n }), 'budget', `exit 4 with ${n} stages done`);
  for (const code of [1, 2, 5, 9, 127, 137, 255, -1, null, undefined]) assert.equal(run({ code, stagesDone: 2 }), 'crash', `exit ${code}`);
  assert.equal(run({ stubbed: true }), 'not_real');
  assert.equal(run({ stubbed: true, stagesDone: 3 }), 'crash', 'a stub run that did not even write its stand-in files is broken, not a stub');
  assert.equal(run({ stagesDone: 5 }), 'crash', 'exit 0 without 50-handoff.json would give a manifest url that answers 404');
  for (const [code, done] of [[0, 6], [3, 0], [3, 4], [4, 2], [1, 1]]) assert.equal(run({ code, stagesDone: done, timedOut: true }), 'timeout', 'a run we killed is a timeout whatever the exit code says');
  assert.equal(run({ code: 0, stubbed: true, timedOut: true }), 'timeout');
});

test('stagesDone counts the leading stages whose contract file exists and is not empty, and never reads what is inside', () => {
  const dir = tempDir();
  assert.equal(stagesDone(dir), 0, 'no run folder yet');
  assert.equal(runDirOf(dir), null);
  assert.equal(stagesDone(join(dir, 'missing')), 0, 'a job folder that is not there');
  const run = join(dir, '20261111-1800-school-example');
  mkdirSync(run);
  writeFileSync(join(dir, 'console.log'), 'x');
  assert.equal(runDirOf(dir), run, 'the one child folder of the job folder');
  assert.equal(stagesDone(dir), 0);
  writeStage(run, 0, 'this is not JSON and is never parsed, scraped text could be anything');
  assert.equal(stagesDone(dir), 1);
  writeStage(run, 2);
  assert.equal(stagesDone(dir), 1, 'a gap stops the count: stage 3 is not done while stage 2 is not');
  writeStage(run, 1);
  assert.equal(stagesDone(dir), 3);
  writeStage(run, 3, '');
  assert.equal(stagesDone(dir), 3, 'an empty file is a file still being written');
  rmSync(join(run, STAGE_FILES[3]));
  mkdirSync(join(run, STAGE_FILES[3]));
  assert.equal(stagesDone(dir), 3, 'a folder with the name of a contract file is not a contract file');
});

test('stagesDone reaches six when every file is there, and 00-run.json alone is not a stage', () => {
  const dir = tempDir();
  const run = join(dir, 'run-1');
  mkdirSync(run);
  writeFileSync(join(run, '00-run.json'), '{}');
  assert.equal(stagesDone(dir), 0);
  STAGE_FILES.forEach((file, i) => {
    writeStage(run, i);
    assert.equal(stagesDone(dir), i + 1, `after ${file}`);
  });
});

test('failedStage reads only a stage name from STAGES and only when the exit code in the log is the process exit code', () => {
  const dir = tempDir();
  const run = join(dir, 'run-1');
  assert.equal(failedStage(dir, 3), null, 'no run folder');
  mkdirSync(run);
  assert.equal(failedStage(dir, 3), null, 'no log');
  const log = (text) => writeFileSync(join(run, 'orchestrator.log'), text);
  log('ok scout 10-inventory.json\nFAILED stage art failed with exit 3 (quality gate failed). Owner: Nirmal (b-design). Inputs: /x/00-run.json\n');
  assert.equal(failedStage(dir, 3), 'art');
  assert.equal(failedStage(dir, 4), null, 'the log says exit 3, the process said 4');
  assert.equal(failedStage(dir, null), null);
  assert.equal(failedStage(dir, '3'), null);
  log('FAILED stage constructor failed with exit 3\n');
  assert.equal(failedStage(dir, 3), null, 'not a stage');
  log('FAILED stage select failed with exit 2 (input failed its schema)\n');
  assert.equal(failedStage(dir, 2), 'select');
  log('FAILED 10-inventory.json failed its schema:\n  /facts must be array\n');
  assert.equal(failedStage(dir, 2), null, 'a failure that is not a stage failure names no stage');
  log('some text FAILED stage art failed with exit 3\n');
  assert.equal(failedStage(dir, 3), null, 'only a line that starts with FAILED');
});

test('wasStubbed is true when the orchestrator log shows a stub fallback, in either spelling, and also when the log cannot be read (it fails closed)', () => {
  const dir = tempDir();
  const run = join(dir, 'run-1');
  mkdirSync(run);
  const log = (text) => writeFileSync(join(run, 'orchestrator.log'), text);
  assert.equal(wasStubbed(dir), true, 'no log at all: a tester must never be shown a result nobody vouches for');
  log('ok scout 10-inventory.json\nok story 20-storyboard.json\nselect: the council says this needs a human; using its top pick. Override with --pick d1, d2 or d3\nok build 50-handoff.json\n');
  assert.equal(wasStubbed(dir), false, 'a real run');
  log('ok scout 10-inventory.json\nSTUB story (lane not present)\nok story 20-storyboard.json\nCROSS skipped (mixed real and stub stages)\n');
  assert.equal(wasStubbed(dir), true, 'a mixed run');
  log('STUB scout ok 10-inventory.json\n');
  assert.equal(wasStubbed(dir), true, 'the stub mode spelling');
  log('Warning: stage a (lane not present) was skipped\n');
  assert.equal(wasStubbed(dir), true, '"lane not present" alone is enough');
  log('');
  assert.equal(wasStubbed(dir), false, 'an empty log is a log: nothing in it says stub');
  assert.equal(wasStubbed(tempDir()), true, 'no run folder');
});

// ---- the queue follows the files ----

test('stage events come in order as the contract files appear: one stage running at a time, running then done, and GET /api/jobs/:id follows', async () => {
  const { app, base, dataDir } = await startApp({ pollMs: 20 });
  const eventsOf = record(app);
  const { json: posted } = await post(base, request({ url: site({ steps: 1 }) }));
  const id = posted.job_id;
  const dir = jobDir(dataDir, id);
  const job = async () => (await getJob(base, id)).json;

  await waitFor(async () => stateList(await job())[0] === 'running', 'scout to be running');
  let now = await job();
  assertJob(now);
  assert.deepEqual([now.status, stateList(now)], ['running', stageStates('running')]);

  for (let i = 0; i < 6; i++) {
    writeFileSync(join(dir, `step-${i + 1}`), '');
    await waitFor(async () => stateList(await job())[i] === 'done', `${STAGES[i]} to be done`);
    now = await job();
    assertJob(now);
    if (i < 5) assert.deepEqual(stateList(now), stageStates(...Array(i + 1).fill('done'), 'running'), `after ${STAGE_FILES[i]}: the next stage is running`);
  }
  now = await finished(base, id);
  assert.equal(now.status, 'done');
  assert.deepEqual(stateList(now), Array(6).fill('done'));
  assert.equal(now.manifest_url, `${VIEWER}/j/${id}/manifest.json`);

  const seen = eventsOf(id);
  const expected = sseFixture('events-done.sse').events.map(({ name, data }) => ({ name, data }));
  assert.deepEqual(JSON.parse(JSON.stringify(seen).split(id).join(FIXTURE_JOB)), expected, 'the queue emitted exactly the events of events-done.sse');
  for (const e of seen) assertValid(`event.v1#/$defs/${e.name}`, e.data);
});

test('a slow poller loses nothing: with a one hour poll interval the final scan at exit still emits every stage, in order', async () => {
  const { app, base, dataDir } = await startApp({ pollMs: 3600_000 });
  const eventsOf = record(app);
  const { json: posted } = await post(base, request({ url: site({ steps: 1 }) }));
  const id = posted.job_id;
  const consoleLog = join(jobDir(dataDir, id), 'console.log');
  await waitFor(() => existsSync(consoleLog) && readFileSync(consoleLog, 'utf8') !== '', 'the fake to start');
  for (let i = 1; i <= 6; i++) writeFileSync(join(jobDir(dataDir, id), `step-${i}`), '');
  assert.equal((await finished(base, id)).status, 'done');
  assert.deepEqual(names(eventsOf(id)), names(sseFixture('events-done.sse').events));
});

test('the poll interval is injectable and a stage shows up within it: a 20 ms poll sees a new file in well under a second', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20 });
  const { json: posted } = await post(base, request({ url: site({ steps: 1 }) }));
  const dir = jobDir(dataDir, posted.job_id);
  await waitFor(async () => stateList((await getJob(base, posted.job_id)).json)[0] === 'running', 'scout');
  writeFileSync(join(dir, 'step-1'), '');
  await waitFor(async () => stateList((await getJob(base, posted.job_id)).json)[0] === 'done', 'scout done', 800);
  for (let i = 2; i <= 6; i++) writeFileSync(join(dir, `step-${i}`), '');
  await finished(base, posted.job_id);
});

test('a file counts as a finished stage only once two polls in a row have seen it, so a stage that writes its file and then exits 3 is never reported done', async () => {
  const { base, dataDir } = await startApp({ pollMs: 300 });
  const { json: posted } = await post(base, request({ url: site({ steps: 1 }) }));
  const id = posted.job_id;
  const first = async () => stateList((await getJob(base, id)).json)[0];
  await waitFor(async () => (await first()) === 'running', 'scout running');
  await sleep(450); // the polls (every 300 ms) have looked at the run folder once, and there was no file; the next two come at about 600 and 900 ms
  const t0 = Date.now();
  writeFileSync(join(jobDir(dataDir, id), 'step-1'), '');
  await waitFor(async () => (await first()) === 'done', 'scout done', 3000);
  const took = Date.now() - t0;
  assert.ok(took > 290, `scout was reported done ${took} ms after its file appeared: less than one poll interval, so one sighting was enough`);
  assert.ok(took < 1500);
  for (let i = 2; i <= 6; i++) writeFileSync(join(jobDir(dataDir, id), `step-${i}`), '');
  assert.equal((await finished(base, id)).status, 'done', 'and a run that exits 0 is done at once, nothing waits for a second sighting');
});

// ---- failures ----

const FAILURES = [
  // [name, query of the fake, code, stage states the job ends with, stage events just before `failed`]
  ['exit 3 at scout (no page could be crawled)', { exit: 3 }, 'site_blocked', stageStates('failed'), ['scout:failed']],
  ['exit 3 after scout', { exit: 3, upto: 1 }, 'quality_gate', stageStates('done', 'failed'), ['story:failed']],
  ['exit 3 in the council', { exit: 3, upto: 3 }, 'quality_gate', stageStates('done', 'done', 'done', 'failed'), ['council:failed']],
  ['exit 3 at build (the build gate)', { exit: 3, upto: 5 }, 'quality_gate', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:failed']],
  ['exit 4 at scout', { exit: 4 }, 'budget', stageStates('failed'), ['scout:failed']],
  ['exit 4 in the art stage', { exit: 4, upto: 2 }, 'budget', stageStates('done', 'done', 'failed'), ['art:failed']],
  ['exit 1', { exit: 1, upto: 2 }, 'crash', stageStates('done', 'done', 'failed'), ['art:failed']],
  ['exit 2 (a contract file failed its schema)', { exit: 2, upto: 4 }, 'crash', stageStates('done', 'done', 'done', 'done', 'failed'), ['select:failed']],
  ['exit 137 (killed from outside)', { exit: 137 }, 'crash', stageStates('failed'), ['scout:failed']],
  ['exit 0 but 50-handoff.json is missing', { upto: 4 }, 'crash', stageStates('done', 'done', 'done', 'done', 'failed'), ['select:failed']],
  ['exit 0 with a stub fallback in the log', { stub: 1 }, 'not_real', Array(6).fill('done'), []],
  ['exit 0 and no orchestrator.log', { nolog: 1 }, 'not_real', Array(6).fill('done'), []],
  // Lanes B and C write their output file and then exit 3 (or 4, Lane C when its budget is gone) when a gate fails: the stage that left a file is still the one that failed.
  ['exit 3 after build wrote 50-handoff.json (Lane C, gates failed)', { exit: 3, upto: 6 }, 'quality_gate', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:failed']],
  ['exit 4 after build wrote 50-handoff.json (Lane C, no budget)', { exit: 4, upto: 6 }, 'budget', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:failed']],
  ['exit 3 after art wrote 30-directions.json (Lane B, gate failed)', { exit: 3, upto: 3, failstage: 'art' }, 'quality_gate', stageStates('done', 'done', 'failed'), ['art:failed']],
  ['exit 3 after story wrote its file', { exit: 3, upto: 2, failstage: 'story' }, 'quality_gate', stageStates('done', 'failed'), ['story:failed']],
  ['exit 3 with every file and no log: the last stage failed', { exit: 3, upto: 6, nolog: 1 }, 'quality_gate', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:failed']],
  ['exit 3 with three files and no log: the first stage without a file failed', { exit: 3, upto: 3, nolog: 1 }, 'quality_gate', stageStates('done', 'done', 'done', 'failed'), ['council:failed']],
];
for (const [name, query, code, finalStates, failedStages] of FAILURES) {
  test(`${name}: ${code}, the stages end ${finalStates.join(',')}, and the events say so with the fixed text`, async () => {
    // A poll hour long: these runs write their files and exit within milliseconds, so only the scan at exit is under test and nothing races it.
    const { app, base } = await startApp({ pollMs: 3600_000 });
    const eventsOf = record(app);
    const { json: posted } = await post(base, request({ url: site({ ...query, noise: 1 }) }));
    const job = await finished(base, posted.job_id);
    const seen = eventsOf(posted.job_id);
    assertJob(job);
    assert.equal(job.status, 'failed');
    assert.deepEqual(job.error, RUN_ERRORS[code], 'the fixed contract text for the code');
    assert.deepEqual(stateList(job), finalStates);
    assert.equal(job.manifest_url, null, 'a failed job has no result to open');
    assert.equal(job.position, null);

    assert.deepEqual(names(seen.slice(-(failedStages.length + 1))), [...failedStages, 'failed'], 'a stage that was running gets a failed event just before failed');
    assert.deepEqual(seen.at(-1).data, RUN_ERRORS[code]);
    assert.equal(seen.filter((e) => e.name === 'failed' || e.name === 'done').length, 1, 'exactly one terminal event, and it is failed');
    assert.equal(seen.filter((e) => e.name === 'failed').length, 1);
    assert.deepEqual(names(seen).filter((n) => n.endsWith(':failed')), failedStages, 'no other stage is marked failed');
    for (const e of seen) assertValid(`event.v1#/$defs/${e.name}`, e.data);
    for (const text of [JSON.stringify(seen), JSON.stringify(job)]) assert.ok(!/SECRET-|FAILED stage|STUB|lane not present/.test(text), 'nothing the orchestrator printed or logged reaches a response or an event');
  });
}

// A lane that wrote its file and then takes longer than a couple of polls to exit 3 (Lane B exits when its loop drains): the poller has already reported the stage done
// and started the next one. The orchestrator's FAILED line still names the stage that failed, so it is shown failed, and every stage after it is pending again.
const LAGGED = [
  ['Lane B, art left its file and exited 3 late (the reviewer probe)', { exit: 3, upto: 3, failstage: 'art', lag: 1000 }, 'quality_gate', stageStates('done', 'done', 'failed'), ['art:done', 'council:running', 'art:failed', 'failed']],
  ['Lane C, build left 50-handoff.json and exited 3 late', { exit: 3, upto: 6, lag: 1000 }, 'quality_gate', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:running', 'build:done', 'build:failed', 'failed']],
  ['Lane C, no budget, handoff written and exited 4 late', { exit: 4, upto: 6, lag: 1000 }, 'budget', stageStates('done', 'done', 'done', 'done', 'done', 'failed'), ['build:running', 'build:done', 'build:failed', 'failed']],
  ['Lane B, story left its file and exited 3 late', { exit: 3, upto: 2, failstage: 'story', lag: 1000 }, 'quality_gate', stageStates('done', 'failed'), ['story:done', 'art:running', 'story:failed', 'failed']],
];
for (const [name, query, code, finalStates, tail] of LAGGED) {
  test(`${name}: the stage the log names ends failed, the later ones pending, and the events stay valid`, async () => {
    const { app, base } = await startApp({ pollMs: 200 });
    const eventsOf = record(app);
    const { json: posted } = await post(base, request({ url: site(query) }));
    const job = await finished(base, posted.job_id);
    const seen = eventsOf(posted.job_id);
    assertJob(job);
    assert.deepEqual(job.error, RUN_ERRORS[code]);
    assert.deepEqual(stateList(job), finalStates, 'the stage that failed is failed, not done, and the next one is not blamed');
    assert.deepEqual(names(seen).slice(-tail.length), tail, 'the last stage event before failed names the stage that failed');
    assert.deepEqual([names(seen).filter((n) => n.endsWith(':failed')).length, names(seen).filter((n) => n === 'failed').length], [1, 1], 'one stage failed event, then one failed event');
    for (const e of seen) assertValid(`event.v1#/$defs/${e.name}`, e.data);
    const streamed = (await readStream(base, posted.job_id)).events;
    assert.deepEqual(streamed.map(({ name: n, data }) => ({ name: n, data })), seen, 'the stream sends the same events');
    assert.deepEqual(streamed.map((e) => e.id), seen.map((_, i) => i + 1));
  });
}

test('a run longer than the timeout fails as timeout and the stage that was running is failed first', async () => {
  const { app, base, dataDir } = await startApp({ timeoutMs: 1500, pollMs: 20 });
  const eventsOf = record(app);
  const { json: posted } = await post(base, request({ url: site({ steps: 1 }) }));
  const id = posted.job_id;
  writeFileSync(join(jobDir(dataDir, id), 'step-1'), '');
  const job = await finished(base, id);
  assert.deepEqual(job.error, RUN_ERRORS.timeout);
  assert.deepEqual(stateList(job), stageStates('done', 'failed'), 'scout was finished, story was running when the run was stopped');
  assert.deepEqual(names(eventsOf(id)).slice(-3), ['story:running', 'story:failed', 'failed']);
});

test('a live job refused at the head of the line (the dollar cap) has no stage events: queued, then failed as budget, all six stages still pending', async () => {
  const { app, base, dataDir } = await startApp({ pollMs: 20, dailyUsdCap: 0 });
  const eventsOf = record(app);
  const first = (await post(base, request({ invite_code: 'A', url: site({ gate: 1 }, 'a.example') }))).json.job_id;
  const second = (await post(base, request({ invite_code: 'B', url: site({}, 'b.example') }))).json.job_id;
  writeFileSync(join(jobDir(dataDir, second), 'live.flag'), '');
  writeFileSync(join(jobDir(dataDir, first), 'go'), '');
  const job = await finished(base, second);
  assert.deepEqual([job.status, job.error.code, job.started_at, stateList(job)], ['failed', 'budget', null, Array(6).fill('pending')]);
  assert.deepEqual(names(eventsOf(second)), ['queued:2', 'queued:1', 'failed']);
});

test('the money still counts: a failed run that reported a cost is added to spend.json, exactly as before T43', async () => {
  const { base, dataDir } = await startApp({ pollMs: 20 });
  const { json: posted } = await post(base, request({ url: site({ exit: 3, upto: 6, vcost: 0.25, hcost: 0.5 }) }));
  const job = await finished(base, posted.job_id);
  assert.equal(job.error.code, 'quality_gate');
  const spend = JSON.parse(readFileSync(join(dataDir, 'spend.json'), 'utf8'));
  assert.deepEqual(Object.values(spend), [0.75]);
});

test('manifest_url is built from the viewer origin the app was given, so the viewer port is configurable', async () => {
  const { base } = await startApp({ pollMs: 20, viewerOrigin: 'http://127.0.0.1:9911' });
  const { json: posted } = await post(base, request());
  const job = await finished(base, posted.job_id);
  assert.equal(job.manifest_url, `http://127.0.0.1:9911/j/${posted.job_id}/manifest.json`);
});

// ---- the viewer child process ----

const FAKE_VIEWER = `
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[1] + '.argv.json', JSON.stringify(process.argv.slice(2)));
console.log('VIEWER-OUTPUT-MARKER');
if (process.env.FAKE_VIEWER_EXIT) process.exit(3);
setInterval(() => {}, 1000);
`;
function quietLog() {
  const lines = { log: [], error: [], warn: [] };
  return { lines, log: (m) => lines.log.push(m), error: (m) => lines.error.push(m), warn: (m) => lines.warn.push(m) };
}

test('startViewer starts the viewer with an argument array (no shell), its output goes to a log file, and stop() ends it', async () => {
  const dir = join(tempDir(), 'a folder & with (odd) chars');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'server.mjs');
  writeFileSync(script, FAKE_VIEWER);
  const jobsRoot = join(dir, 'jobs & more');
  const logFile = join(dir, 'viewer.log');
  const log = quietLog();
  const viewer = startViewer({ script, jobsRoot, port: 8788, appOrigin: 'http://127.0.0.1:8787', logFile, log });
  assert.ok(viewer);
  await waitFor(() => existsSync(`${script}.argv.json`) && readFileSync(`${script}.argv.json`, 'utf8') !== '', 'the viewer to start');
  assert.deepEqual(JSON.parse(readFileSync(`${script}.argv.json`, 'utf8')), ['--jobs-root', jobsRoot, '--port', '8788', '--app-origin', 'http://127.0.0.1:8787']);
  await waitFor(() => /VIEWER-OUTPUT-MARKER/.test(readFileSync(logFile, 'utf8')), 'the viewer output in its log file');
  const pid = viewer.child.pid;
  assert.ok(alive(pid));
  await viewer.stop();
  assert.ok(!alive(pid), 'stop() ended it');
  assert.deepEqual(log.lines.error, [], 'a viewer we stopped is not an error');
  await viewer.stop(); // stopping twice is harmless
});

test('startViewer with no viewer script says that results cannot be viewed and returns null instead of failing', () => {
  const log = quietLog();
  const viewer = startViewer({ script: join(tempDir(), 'web', 'viewer', 'server.mjs'), jobsRoot: tempDir(), port: 8788, appOrigin: 'http://127.0.0.1:8787', logFile: join(tempDir(), 'viewer.log'), log });
  assert.equal(viewer, null);
  const said = [...log.lines.error, ...log.lines.warn];
  assert.equal(said.length, 1);
  assert.match(said[0], /results cannot be viewed/i);
});

test('a viewer that stops by itself is reported once, so Abhinav knows results cannot be opened', async () => {
  const dir = tempDir();
  const script = join(dir, 'server.mjs');
  writeFileSync(script, FAKE_VIEWER);
  const log = quietLog();
  process.env.FAKE_VIEWER_EXIT = '1';
  let viewer;
  try {
    viewer = startViewer({ script, jobsRoot: dir, port: 8788, appOrigin: 'http://127.0.0.1:8787', logFile: join(dir, 'viewer.log'), log });
    await waitFor(() => log.lines.error.length > 0, 'the exit to be reported');
  } finally {
    delete process.env.FAKE_VIEWER_EXIT;
  }
  assert.equal(log.lines.error.length, 1);
  assert.match(log.lines.error[0], /viewer.*(stopped|exited)/i);
  assert.match(log.lines.error[0], /results cannot be viewed/i);
  await viewer.stop();
});

// ---- the server program starts the viewer ----

const SERVER = join(here, '..', 'server.mjs');
async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const PROGRAM_VIEWER = `
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[1] + '.json', JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }));
setTimeout(() => process.exit(0), 60000); // never outlives a test that forgot it
setInterval(() => {}, 1000);
`;

test('the server program starts the viewer on --viewer-port with --jobs-root <data dir>/jobs and its own port as the app origin, and manifest_url points at it', async () => {
  const dataDir = tempDir();
  const script = join(tempDir(), 'viewer.mjs');
  writeFileSync(script, PROGRAM_VIEWER);
  const viewerPort = await freePort();
  const child = spawn(process.execPath, [SERVER, '--port', '0', '--data-dir', dataDir, '--orchestrator', FAKE, '--allow-local', '--viewer-script', script, '--viewer-port', String(viewerPort)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  let viewerPid = null;
  try {
    const appPort = await waitFor(() => /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1], 'the server program to listen');
    const started = await waitFor(() => existsSync(`${script}.json`) && readFileSync(`${script}.json`, 'utf8') !== '' && JSON.parse(readFileSync(`${script}.json`, 'utf8')), 'the viewer to start');
    viewerPid = started.pid;
    assert.deepEqual(started.argv, ['--jobs-root', join(dataDir, 'jobs'), '--port', String(viewerPort), '--app-origin', `http://127.0.0.1:${appPort}`]);
    assert.match(out, new RegExp(`Results viewer started on http://127\.0\.0\.1:${viewerPort}`));
    const codeOf = spawnSync(process.execPath, [join(here, '..', 'admin.mjs'), '--data-dir', dataDir, 'invite', 'add', 'pilot-1'], { encoding: 'utf8' }).stdout.match(/[A-Z2-9]{12}/)[0];
    const posted = await post(`http://127.0.0.1:${appPort}`, request({ invite_code: codeOf, url: 'http://127.0.0.1:9/?x=1' }));
    assert.equal(posted.status, 202, JSON.stringify(posted.json));
    const job = await finished(`http://127.0.0.1:${appPort}`, posted.json.job_id);
    assert.equal(job.manifest_url, `http://127.0.0.1:${viewerPort}/j/${posted.json.job_id}/manifest.json`);
    if (process.platform !== 'win32') {
      child.kill('SIGTERM'); // Node cannot send a catchable signal on Windows; there the viewer shares the console and Ctrl+C reaches it
      await waitFor(() => !alive(viewerPid), 'the viewer to stop with the server');
    }
  } finally {
    child.kill();
    if (viewerPid !== null) {
      try {
        process.kill(viewerPid);
      } catch {}
    }
  }
});

test('the viewer port is 8788 unless --viewer-port says otherwise', async () => {
  const script = join(tempDir(), 'viewer.mjs');
  writeFileSync(script, PROGRAM_VIEWER);
  const child = spawn(process.execPath, [SERVER, '--port', '0', '--data-dir', tempDir(), '--orchestrator', FAKE, '--viewer-script', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  let viewerPid = null;
  try {
    const started = await waitFor(() => existsSync(`${script}.json`) && readFileSync(`${script}.json`, 'utf8') !== '' && JSON.parse(readFileSync(`${script}.json`, 'utf8')), 'the viewer to start');
    viewerPid = started.pid;
    assert.equal(started.argv[started.argv.indexOf('--port') + 1], '8788');
  } finally {
    child.kill();
    if (viewerPid !== null) {
      try {
        process.kill(viewerPid);
      } catch {}
    }
  }
});

test('the server program without a viewer script says that results cannot be viewed; --no-viewer starts none; a bad --viewer-port is a usage error', async () => {
  const lacking = spawn(process.execPath, [SERVER, '--port', '0', '--data-dir', tempDir(), '--orchestrator', FAKE, '--viewer-script', join(tempDir(), 'nope.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  lacking.stdout.on('data', (d) => (out += d));
  lacking.stderr.on('data', (d) => (out += d));
  try {
    await waitFor(() => /results cannot be viewed/i.test(out), 'the missing viewer to be reported');
    assert.match(out, /listening on/);
  } finally {
    lacking.kill();
  }
  const none = spawn(process.execPath, [SERVER, '--port', '0', '--data-dir', tempDir(), '--orchestrator', FAKE, '--no-viewer', '--viewer-script', join(tempDir(), 'nope.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  out = '';
  none.stdout.on('data', (d) => (out += d));
  none.stderr.on('data', (d) => (out += d));
  try {
    await waitFor(() => /--no-viewer/.test(out), 'the --no-viewer line');
    assert.ok(!/cannot be viewed/i.test(out));
  } finally {
    none.kill();
  }
  for (const args of [['--viewer-port', '0'], ['--viewer-port', 'abc'], ['--viewer-port', '70000'], ['--viewer-port', '8787', '--port', '8787'], ['--viewer-port']]) {
    const r = spawnSync(process.execPath, [SERVER, '--data-dir', tempDir(), ...args], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
    assert.match(r.stderr, /--viewer-port/);
  }
});
