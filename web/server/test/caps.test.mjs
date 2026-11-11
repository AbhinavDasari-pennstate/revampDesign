// Tests for the live switch, the daily dollar cap and the spend ledger (plan/web-plan.md T47), and the admin commands live and spend.
// Never a paid model: the orchestrator is the fake one from test/fake-orchestrator.mjs, which only records the flags it was given and writes the costs the test asks for.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ERRORS } from '../messages.mjs';
import { laDay } from '../ledger.mjs';
import { createApp } from '../server.mjs';
import { argvOf, assertJob, assertValid, cleanup, contracts, finished, fixture, getJob, jobDir, post, request, site, startApp, tempDir, waitFor } from './harness.mjs';

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const ADMIN = join(serverDir, 'admin.mjs');
const NOW = new Date('2026-11-11T20:00:00Z'); // 12:00 on Nov 11 in Los Angeles
const DAY = '2026-11-11';
const now = () => NOW;
const flagOf = (dataDir, id) => join(jobDir(dataDir, id), 'live.flag');
const spendFile = (dataDir) => join(dataDir, 'spend.json');
const spendOf = (dataDir) => JSON.parse(readFileSync(spendFile(dataDir), 'utf8'));

// A job that waits for <its folder>/go holds the line, so the jobs behind it can get their live flag before any of them starts.
// jobs: [{ live, params }] in line order; params are the fake orchestrator's knobs. release() lets the line move.
async function lineUp(base, dataDir, jobs) {
  const blocker = (await post(base, request({ url: site({ gate: 1 }, 'gate.example') }))).json.job_id;
  const ids = [];
  for (const [i, { live = false, params = {} }] of jobs.entries()) {
    const res = await post(base, request({ url: site({ n: i, ...params }, `j${i}.example`) }));
    assert.equal(res.status, 202, JSON.stringify(res.json));
    ids.push(res.json.job_id);
    if (live) writeFileSync(flagOf(dataDir, res.json.job_id), 'live\n');
  }
  return { ids, release: () => writeFileSync(join(jobDir(dataDir, blocker), 'go'), '') };
}

// A live job refused before it started is the contract's job-failed-budget-at-start.json (ids and times aside).
function assertRefusedAtStart(job) {
  assertJob(job);
  const want = fixture('job-failed-budget-at-start.json');
  assert.deepEqual({ ...job, job_id: want.job_id, created_at: want.created_at, finished_at: want.finished_at }, want);
  assert.notEqual(job.finished_at, null);
}

// A run template with its own lane budgets, in the folder the server reads it from.
function templateWith(dir, budgets) {
  const doc = JSON.parse(readFileSync(join(contracts, 'fixtures/sample/00-run.json'), 'utf8'));
  const file = join(dir, 'template.json');
  writeFileSync(file, JSON.stringify({ ...doc, limits: { ...doc.limits, lane_budget_usd: budgets } }));
  return file;
}

function admin(dataDir, ...args) {
  const r = spawnSync(process.execPath, [ADMIN, '--data-dir', dataDir, ...args], { encoding: 'utf8', cwd: tempDir() });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---- the live switch ----

test('a job runs with --live only when live.flag exists at the moment it starts, and job.v1.mode and the started event say so', async () => {
  const { app, base, dataDir } = await startApp({ dailyUsdCap: 100, now });
  const events = [];
  app.queue.on('event', (id, name, data) => events.push({ id, name, data }));
  const { ids: [free, live], release } = await lineUp(base, dataDir, [{}, { live: true }]);
  release();
  const [doneFree, doneLive] = [await finished(base, free), await finished(base, live)];
  assertJob(doneFree);
  assertJob(doneLive);
  assert.deepEqual([doneFree.status, doneFree.mode, doneLive.status, doneLive.mode], ['done', 'free', 'done', 'live']);
  assert.ok(!argvOf(dataDir, free).includes('--live'));
  const argv = argvOf(dataDir, live);
  assert.equal(argv.filter((a) => a === '--live').length, 1);
  assert.deepEqual(argv.slice(0, 6), ['run', '--url', site({ n: 1 }, 'j1.example'), '--tier', 'B', '--consent-note'], 'the same command line as a free run, plus --live');
  assert.equal(argv.at(-1), '--live');
  assert.deepEqual(events.find((e) => e.id === live && e.name === 'started').data, { mode: 'live' });
  assert.deepEqual(events.find((e) => e.id === free && e.name === 'started').data, { mode: 'free' });
  assert.equal(JSON.parse(readFileSync(join(jobDir(dataDir, live), 'job.json'), 'utf8')).mode, 'live', 'saved with the job');
  for (const e of events.filter((e) => e.name === 'started')) assertValid('event.v1#/$defs/started', e.data);

  // a flag that appears after the job started changes nothing
  const late = (await post(base, request({ url: site({ gate: 1 }, 'late.example') }))).json.job_id;
  await waitFor(async () => (await getJob(base, late)).json.status === 'running', 'the job to start');
  writeFileSync(flagOf(dataDir, late), 'live\n');
  writeFileSync(join(jobDir(dataDir, late), 'go'), '');
  const doneLate = await finished(base, late);
  assert.equal(doneLate.mode, 'free');
  assert.ok(!argvOf(dataDir, late).includes('--live'));
});

// ---- the dollar cap ----

test('the default cap is 0: a live job is refused when it reaches the head of the line (failed budget, never started) and the next job goes ahead', async () => {
  const { app, base, dataDir } = await startApp({ now }); // no dailyUsdCap given
  const events = [];
  app.queue.on('event', (id, name, data) => events.push({ id, name, data }));
  const { ids: [refused, after], release } = await lineUp(base, dataDir, [{ live: true }, {}]);
  release();
  const job = await finished(base, refused);
  assertRefusedAtStart(job);
  assert.equal(existsSync(join(jobDir(dataDir, refused), 'console.log')), false, 'the orchestrator was never started');
  assert.equal((await finished(base, after)).status, 'done');
  const names = events.filter((e) => e.id === refused).map((e) => e.name);
  assert.ok(!names.includes('started') && names.at(-1) === 'failed', names.join(','));
  const failed = events.find((e) => e.id === refused && e.name === 'failed');
  assertValid('event.v1#/$defs/failed', failed.data);
  assert.deepEqual(failed.data, fixture('job-failed-budget-at-start.json').error);
  const saved = JSON.parse(readFileSync(join(jobDir(dataDir, refused), 'job.json'), 'utf8'));
  assert.deepEqual([saved.status, saved.mode, saved.started_at], ['failed', 'live', null]);
  assert.equal(existsSync(spendFile(dataDir)), false, 'a run that never started costs nothing');
});

test('with a cap of 10 and lane budgets b + c = 6 (the sample run template): a live job starts at 0 spent, and after 5 is spent the next live job is refused while a free one still runs', async () => {
  const { base, dataDir } = await startApp({ dailyUsdCap: 10, now });
  const { ids: [first, second, free], release } = await lineUp(base, dataDir, [{ live: true, params: { vcost: 3, hcost: 2 } }, { live: true }, {}]);
  release();
  const done = await finished(base, first);
  assert.deepEqual([done.status, done.mode], ['done', 'live']);
  assert.deepEqual(spendOf(dataDir), { [DAY]: 5 });
  assertRefusedAtStart(await finished(base, second)); // 5 + 6 is more than 10
  const ran = await finished(base, free);
  assert.deepEqual([ran.status, ran.mode], ['done', 'free'], 'a free run is never refused for the cap');
});

test('a live job whose budget exactly fills the cap is allowed (spent + b + c is over the cap only when it is more)', async () => {
  const { base, dataDir } = await startApp({ dailyUsdCap: 6, now });
  const { ids: [id], release } = await lineUp(base, dataDir, [{ live: true }]);
  release();
  assert.equal((await finished(base, id)).status, 'done');
});

test('a live job that would start when the spend is at or above the cap fails with budget, even if its own budget is 0', async () => {
  const dir = tempDir();
  const { base, dataDir } = await startApp({ dailyUsdCap: 5, runTemplate: templateWith(dir, { a: 0, b: 0, c: 0 }), now });
  const { ids: [one, two, three], release } = await lineUp(base, dataDir, [{ live: true, params: { vcost: 4.99 } }, { live: true, params: { hcost: 0.01 } }, { live: true }]);
  release();
  assert.equal((await finished(base, one)).status, 'done'); // 0 spent
  assert.equal((await finished(base, two)).status, 'done'); // 4.99 spent: below the cap
  assert.deepEqual(spendOf(dataDir), { [DAY]: 5 });
  assertRefusedAtStart(await finished(base, three)); // 5 spent: at the cap
});

test('a live job is refused as budget when the run template or spend.json cannot be read, instead of being started', async () => {
  const errors = [];
  const log = { log() {}, error: (m) => errors.push(String(m)) };
  const broken = tempDir();
  const writeTemplate = (name, text) => (writeFileSync(join(broken, name), text), join(broken, name));
  for (const runTemplate of [join(broken, 'missing.json'), writeTemplate('empty.json', '{}'), writeTemplate('text.json', '{not json'), templateWith(broken, { a: 1, b: 'x', c: 1 }), templateWith(broken, { a: 1, b: -1, c: 1 })]) {
    const { base, dataDir } = await startApp({ dailyUsdCap: 100, runTemplate, now, log });
    const { ids: [live], release } = await lineUp(base, dataDir, [{ live: true }]);
    release();
    assertRefusedAtStart(await finished(base, live));
    assert.equal(existsSync(join(jobDir(dataDir, live), 'console.log')), false, runTemplate);
  }
  const { base, dataDir } = await startApp({ dailyUsdCap: 100, now, log });
  writeFileSync(spendFile(dataDir), '{not json');
  const { ids: [live, free], release } = await lineUp(base, dataDir, [{ live: true }, { params: { vcost: 1 } }]);
  release();
  assertRefusedAtStart(await finished(base, live));
  assert.equal((await finished(base, free)).status, 'done', 'a free run still runs');
  assert.equal(readFileSync(spendFile(dataDir), 'utf8'), '{not json', 'a file that cannot be read is never overwritten');
  assert.ok(errors.length >= 6 && errors.some((m) => /spend\.json/.test(m)) && errors.some((m) => /template/.test(m)), errors.join(' | '));
});

test('a daily cap that is not a number of dollars (0 or more) is refused when the app is made, because a NaN cap would let every comparison pass', () => {
  for (const bad of [NaN, -1, '5', null, Infinity, {}]) {
    assert.throws(() => createApp({ dataDir: tempDir(), dailyUsdCap: bad, log: { log() {}, error() {} } }), /dailyUsdCap/, String(bad));
  }
  assert.doesNotThrow(() => createApp({ dataDir: tempDir(), dailyUsdCap: 0, log: { log() {}, error() {} } }).queue.close());
});

test('daily_cap_reached is never sent: with the default cap of 0 a start request is accepted, and no response or source line produces the code', async () => {
  const { base, dataDir } = await startApp({ now });
  const { ids: [live], release } = await lineUp(base, dataDir, [{ live: true }]);
  release();
  const bodies = [JSON.stringify((await post(base, request())).json), JSON.stringify(await finished(base, live)), JSON.stringify((await getJob(base, live)).json)];
  for (const body of bodies) assert.ok(!body.includes('daily_cap_reached'), body);
  assert.equal((await post(base, request())).status, 202);
  assert.equal(Object.hasOwn(API_ERRORS, 'daily_cap_reached'), false);
  for (const file of ['server.mjs', 'queue.mjs', 'invites.mjs', 'messages.mjs']) {
    const code = readFileSync(join(serverDir, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//'));
    assert.deepEqual(code.filter((l) => l.includes('daily_cap_reached')), [], file);
  }
});

// ---- the spend ledger ----

test('after every run the server adds cost_usd of 40-verdict.json and 50-handoff.json to spend.json under the Los Angeles day; a free run that cost something is warned about and still counted', async () => {
  const clock = { t: new Date('2026-11-11T20:00:00Z') };
  const warns = [];
  const { base, dataDir } = await startApp({ now: () => clock.t, log: { log() {}, error() {}, warn: (m) => warns.push(String(m)) } });
  let n = 0;
  const run = async (params) => finished(base, (await post(base, request({ url: site(params, `r${n++}.example`) }))).json.job_id);

  await run({});
  assert.equal(existsSync(spendFile(dataDir)), false, 'no cost, no file');
  assert.deepEqual(warns, []);
  await run({ vcost: 0.1 });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 0.1 });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /free/);
  assert.match(warns[0], /0\.1/);
  await run({ hcost: 0.2 });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 0.3 }, 'sums are rounded to a millionth of a dollar: 0.1 + 0.2 is not left as 0.30000000000000004');
  await run({ vcost: 0.3, hcost: 0.2 });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 0.8 }, 'both files of one run are added');
  clock.t = new Date('2026-11-12T07:59:59Z'); // 23:59:59 in Los Angeles
  await run({ hcost: 1 });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 1.8 });
  clock.t = new Date('2026-11-12T08:00:00Z');
  await run({ vcost: 2 });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 1.8, '2026-11-12': 2 }, 'the next Los Angeles day has its own total');
});

test('the cost of a run that failed is counted too, and a cost that is not a number of at least 0 is ignored with a warning', async () => {
  const warns = [];
  const { base, dataDir } = await startApp({ now, log: { log() {}, error() {}, warn: (m) => warns.push(String(m)) } });
  let n = 0;
  const run = async (params) => finished(base, (await post(base, request({ url: site(params, `r${n++}.example`) }))).json.job_id);

  const crashed = await run({ exit: 1, files: 1, vcost: 2 });
  assert.deepEqual([crashed.status, crashed.error.code], ['failed', 'crash']);
  assert.deepEqual(spendOf(dataDir), { [DAY]: 2 }, 'money spent by a run that then crashed is spent');
  warns.length = 0;
  await run({ vcost: -1, hcost: 'abc' });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 2 }, 'a negative cost and a text cost count for nothing');
  assert.equal(warns.filter((m) => /cost_usd/.test(m)).length, 2, warns.join(' | '));
  await run({ vcost: 0.5, hcost: 'abc' });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 2.5 }, 'the readable one is still counted');
  await run({ vcost: 0.5, hcost: 'str:3' });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 3 }, 'a number written as text ("3") is not a cost: only the 0.5 counts');
  await run({ exit: 1 }); // died before writing any file
  assert.deepEqual(spendOf(dataDir), { [DAY]: 3 });
});

test('a run that was still going when the server stopped has its cost counted when the server starts again, and only once', async () => {
  const dataDir = tempDir();
  const id = 'runningJobRunningJob02';
  const runDir = join(dataDir, 'jobs', id, 'fake-run-1');
  mkdirSync(runDir, { recursive: true });
  const T = '2026-11-11T10:00:00.000Z';
  const stages = ['running', 'pending', 'pending', 'pending', 'pending', 'pending'].map((state, i) => ({ stage: ['scout', 'story', 'art', 'council', 'select', 'build'][i], state }));
  writeFileSync(join(dataDir, 'jobs', id, 'job.json'), JSON.stringify({ ...fixture('job-queued.json'), job_id: id, status: 'running', mode: 'live', position: null, started_at: T, stages, invite_label: 'x', url: 'https://school.example/', consent_note: 'n' }));
  writeFileSync(join(runDir, '40-verdict.json'), JSON.stringify({ cost_usd: 1.25 }));
  writeFileSync(join(runDir, '50-handoff.json'), JSON.stringify({ cost_usd: 0.25 }));
  const first = await startApp({ dataDir, now });
  assert.equal((await getJob(first.base, id)).json.error.code, 'server_restarted');
  assert.deepEqual(spendOf(dataDir), { [DAY]: 1.5 });
  await first.app.close();
  await startApp({ dataDir, now });
  assert.deepEqual(spendOf(dataDir), { [DAY]: 1.5 }, 'the job is already failed: not counted again');
});

// ---- admin.mjs live and spend ----

test('admin live <job_id> on|off sets and clears the flag of a job that is still queued, and refuses anything else', async () => {
  const { base, dataDir } = await startApp({ dailyUsdCap: 100, now });
  const { ids: [a, b], release } = await lineUp(base, dataDir, [{}, {}]);
  const on = admin(dataDir, 'live', a, 'on');
  assert.equal(on.code, 0, on.err);
  assert.match(on.out, /--daily-usd-cap/, 'says what else decides');
  assert.ok(existsSync(flagOf(dataDir, a)));
  assert.equal(admin(dataDir, 'live', a, 'off').code, 0);
  assert.equal(existsSync(flagOf(dataDir, a)), false);
  assert.equal(admin(dataDir, 'live', a, 'off').code, 0, 'off is fine when it is already off');
  assert.equal(admin(dataDir, 'live', a, 'on').code, 0);

  for (const bad of ['Xk3nP9qLm2VbT7sRw4YdHa', '../x', 'short', 'constructor', `${a}/..`]) {
    const r = admin(dataDir, 'live', bad, 'on');
    assert.equal(r.code, 1, bad);
    assert.match(r.err, /job/);
  }
  mkdirSync(join(dataDir, 'elsewhere'));
  writeFileSync(join(dataDir, 'elsewhere', 'job.json'), JSON.stringify({ status: 'queued' }));
  const sneaky = admin(dataDir, 'live', '../elsewhere', 'on'); // a folder that has a job.json but is not a job of this server
  assert.equal(sneaky.code, 1);
  assert.equal(existsSync(join(dataDir, 'elsewhere', 'live.flag')), false, 'nothing is written outside <data dir>/jobs/<job id>/');
  assert.equal(admin(dataDir, 'live', a, 'maybe').code, 2);
  assert.deepEqual(readdirSync(jobDir(dataDir, a)).filter((f) => f.endsWith('.flag')), ['live.flag']);

  release();
  assert.equal((await finished(base, a)).mode, 'live');
  assert.ok(argvOf(dataDir, a).includes('--live'));
  assert.equal((await finished(base, b)).mode, 'free');
  const late = admin(dataDir, 'live', b, 'on');
  assert.equal(late.code, 1, 'the job has run: the switch cannot change it any more');
  assert.match(late.err, /done/);
  assert.equal(existsSync(flagOf(dataDir, b)), false);
});

test('admin live works for a job id that starts with a dash or an underscore (base64url ids do), and --data-dir=<dir> is accepted', () => {
  const dir = tempDir();
  for (const id of ['-AbCdEfGhIjKlMnOpQrSt0', '_AbCdEfGhIjKlMnOpQrSt0', '--bCdEfGhIjKlMnOpQrSt0']) {
    mkdirSync(join(dir, 'jobs', id), { recursive: true });
    writeFileSync(join(dir, 'jobs', id, 'job.json'), JSON.stringify({ status: 'queued' }));
    const on = admin(dir, 'live', id, 'on');
    assert.equal(on.code, 0, `${id}: ${on.err}`);
    assert.ok(existsSync(join(dir, 'jobs', id, 'live.flag')), id);
    assert.equal(admin(dir, 'live', id, 'off').code, 0, id);
    assert.equal(existsSync(join(dir, 'jobs', id, 'live.flag')), false, id);
  }
  const eq = spawnSync(process.execPath, [ADMIN, `--data-dir=${dir}`, 'spend'], { encoding: 'utf8', cwd: tempDir() });
  assert.equal(eq.status, 0, eq.stderr);
  assert.equal(admin(dir, '--nope').code, 2, 'an unknown option is a usage error');
  const missing = spawnSync(process.execPath, [ADMIN, 'spend', '--data-dir'], { encoding: 'utf8', cwd: tempDir() });
  assert.equal(missing.status, 2);
});

test('admin spend shows today and every recorded day, newest first, and refuses a spend.json it cannot read', () => {
  const dir = tempDir();
  const empty = admin(dir, 'spend');
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /Today \(\d{4}-\d{2}-\d{2}\): \$0\.00/);
  assert.match(empty.out, /No spend recorded yet/);
  const today = laDay(new Date());
  writeFileSync(spendFile(dir), JSON.stringify({ '2020-01-01': 0.25, '2020-01-02': 1.5, [today]: 3.5 }));
  const shown = admin(dir, 'spend');
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, new RegExp(`Today \\(${today}\\): \\$3\\.50`));
  const rows = shown.out.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}\s/.test(l));
  assert.deepEqual(rows.map((r) => r.split(/\s+/)[0]), [today, '2020-01-02', '2020-01-01']);
  assert.match(rows[2], /\$0\.25/);
  for (const text of ['{not json', '[]', 'null', '"5"', '{"2026-11-11":"5"}', '{"2026-11-11":-1}', '{"yesterday":1}', '{"2026-11-11":null}']) {
    writeFileSync(spendFile(dir), text);
    const broken = admin(dir, 'spend');
    assert.equal(broken.code, 1, text);
    assert.match(broken.err, /spend\.json/, text);
  }
});
