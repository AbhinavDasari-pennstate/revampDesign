// Tests for the tester web app HTTP contract (contracts/web/, plan/web-plan.md section 2).
// The web schemas live in contracts/web/schemas/ and are NOT loaded by validate.mjs (that one validates run-folder files),
// so this file builds its own Ajv instance, the same way test/load.mjs does for the run-folder schemas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const sample = fileURLToPath(new URL('../fixtures/sample/', import.meta.url));
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

const SCHEMAS = ['start-request', 'job', 'event', 'error', 'manifest'];
// Section 2 of plan/web-plan.md, typed in by hand so the tests do not trust the schemas they check.
const API_CODES = ['bad_request', 'bad_url', 'host_not_public', 'owner_name_required', 'consent_required', 'invite_invalid', 'invite_used_today', 'daily_cap_reached', 'queue_full', 'not_found'];
const RUN_CODES = ['site_blocked', 'quality_gate', 'budget', 'not_real', 'timeout', 'crash', 'server_restarted'];
const STAGES = ['scout', 'story', 'art', 'council', 'select', 'build'];
const EVENTS = ['queued', 'started', 'stage', 'done', 'failed'];
const VIEWER = 'http://127.0.0.1:8788';
const JOB_ID = 'Xk3nP9qLm2VbT7sRw4YdHa';

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const f of readdirSync(join(web, 'schemas'))) ajv.addSchema(readJson(join(web, 'schemas', f)));

function errorsOf(id, data) {
  const validate = ajv.getSchema(id);
  assert.ok(validate, `schema ${id} is not registered`);
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}
const valid = (id, data) => assert.deepEqual(errorsOf(id, data), [], id);
const invalid = (id, data, why) => assert.notDeepEqual(errorsOf(id, data), [], `${why} should be rejected by ${id}`);
const fixture = (name) => readJson(join(web, 'fixtures', name));
const clone = (x) => structuredClone(x);

// One schema per fixture file, chosen by file name so a new fixture is checked without editing this list.
const schemaForFixture = (name) => {
  if (name === 'start-request.json') return 'start-request.v1';
  if (/^job-[a-z_-]+\.json$/.test(name)) return 'job.v1';
  if (/^error-[a-z_]+\.json$/.test(name)) return 'error.v1';
  if (/^manifest[a-z-]*\.json$/.test(name)) return 'manifest.v1';
  return null;
};
const fixtureNames = () => readdirSync(join(web, 'fixtures')).sort();

// Minimal SSE reader for the .sse fixtures: blocks split by a blank line, one data line each, comment lines (": ping") skipped.
function parseSse(name) {
  const events = [];
  for (const block of read(join(web, 'fixtures', name)).split(/\r?\n\r?\n/)) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const key = line.slice(0, i);
      assert.ok(['id', 'event', 'data'].includes(key), `${name}: unknown SSE field ${key}`);
      assert.ok(!(key in fields), `${name}: ${key} appears twice in one event`);
      fields[key] = line.slice(i + 1).replace(/^ /, '');
    }
    if (Object.keys(fields).length) events.push({ id: Number(fields.id), event: fields.event, raw: fields.data, data: JSON.parse(fields.data) });
  }
  return events;
}

test('the five web schemas compile under draft 2020-12 with strict mode', () => {
  for (const n of SCHEMAS) assert.ok(ajv.getSchema(`${n}.v1`), `${n}.v1 missing`);
  assert.deepEqual(readdirSync(join(web, 'schemas')).sort(), SCHEMAS.map((n) => `${n}.v1.schema.json`).sort());
});

test('HTTP payloads carry no contract or version field: the schema name and the route are the version', () => {
  for (const n of SCHEMAS) {
    const text = read(join(web, 'schemas', `${n}.v1.schema.json`));
    assert.ok(!/"(contract|version)"\s*:\s*\{/.test(text), `${n} declares contract or version`);
  }
});

test('every JSON fixture validates against its schema', () => {
  let count = 0;
  for (const name of fixtureNames().filter((f) => f.endsWith('.json'))) {
    const id = schemaForFixture(name);
    assert.ok(id, `no schema is mapped to fixture ${name}`);
    valid(id, fixture(name));
    count += 1;
  }
  assert.ok(count >= 20, `expected the full fixture set, found ${count}`);
});

test('the fixture folder holds only JSON and the three .sse streams', () => {
  const others = fixtureNames().filter((f) => !f.endsWith('.json'));
  assert.deepEqual(others, ['events-done.sse', 'events-failed.sse', 'events-queued.sse']);
});

test('there is one valid request and one job response for each of the four statuses', () => {
  assert.ok(existsSync(join(web, 'fixtures/start-request.json')));
  const statuses = fixtureNames().filter((f) => /^job-/.test(f)).map((f) => fixture(f).status);
  for (const s of ['queued', 'running', 'done', 'failed']) assert.ok(statuses.includes(s), `no job fixture with status ${s}`);
});

test('every error code of section 2 has exactly one fixture with a fixed plain-language message', () => {
  const seen = new Map();
  for (const code of API_CODES) {
    const f = fixture(`error-${code}.json`);
    assert.equal(f.error.code, code, `error-${code}.json carries another code`);
    seen.set(code, f.error.message);
  }
  for (const code of RUN_CODES) {
    const f = fixture(`job-failed-${code}.json`);
    assert.equal(f.status, 'failed');
    assert.equal(f.error.code, code, `job-failed-${code}.json carries another code`);
    seen.set(code, f.error.message);
  }
  assert.equal(seen.size, API_CODES.length + RUN_CODES.length);
  assert.equal(new Set(seen.values()).size, seen.size, 'two codes share one message');
  const files = fixtureNames().filter((f) => /^(error|job-failed)-/.test(f));
  assert.equal(files.length, seen.size, 'a code has more than one fixture, or a fixture has no code');
  for (const [code, message] of seen) {
    assert.match(message, /^[A-Z][^<>{}\\`]*[.?]$/, `${code}: message must be one plain sentence or two, ending in a full stop`);
    assert.ok(message.length <= 160, `${code}: message too long`);
    assert.ok(!/(exit|stack|trace|undefined|null|orchestrator|node|http 4|http 5)/i.test(message), `${code}: message leaks a technical term`);
  }
});

test('the schemas pin the exact code list and the exact message text, so a drifted message fails validation', () => {
  for (const code of API_CODES) {
    const f = fixture(`error-${code}.json`);
    f.error.message += ' Extra words.';
    invalid('error.v1', f, `${code} with a changed message`);
  }
  for (const code of RUN_CODES) {
    const f = fixture(`job-failed-${code}.json`);
    f.error.message = 'Traceback (most recent call last): boom';
    invalid('job.v1', f, `${code} with scraped or technical text`);
  }
  const other = fixture('error-bad_url.json');
  other.error.code = 'teapot';
  invalid('error.v1', other, 'an unknown code');
  const apiCodeInJob = fixture('job-failed-crash.json');
  apiCodeInJob.error = fixture('error-queue_full.json').error;
  invalid('job.v1', apiCodeInJob, 'an API error code in job.error');
  const runCodeInError = fixture('error-bad_url.json');
  runCodeInError.error = fixture('job-failed-crash.json').error;
  invalid('error.v1', runCodeInError, 'a run failure code in error.v1');
});

test('start-request.v1: the one valid request passes and each broken field is rejected', () => {
  const good = fixture('start-request.json');
  assert.deepEqual(Object.keys(good).sort(), ['consent', 'invite_code', 'owner_name', 'url']);
  const tweak = (patch) => ({ ...clone(good), ...patch });
  invalid('start-request.v1', tweak({ consent: false }), 'consent false');
  invalid('start-request.v1', tweak({ consent: 'true' }), 'consent as a string');
  invalid('start-request.v1', tweak({ owner_name: '' }), 'an empty owner name');
  invalid('start-request.v1', tweak({ owner_name: '   ' }), 'a blank owner name');
  invalid('start-request.v1', tweak({ owner_name: 'x'.repeat(201) }), 'an owner name over 200 characters');
  invalid('start-request.v1', tweak({ url: 'ftp://example.com/' }), 'an ftp url');
  invalid('start-request.v1', tweak({ url: 'example.com' }), 'a url without a scheme');
  invalid('start-request.v1', tweak({ url: 'https://example.com/ a' }), 'a url with a space');
  invalid('start-request.v1', tweak({ invite_code: '' }), 'an empty invite code');
  invalid('start-request.v1', tweak({ extra: 1 }), 'an extra field');
  for (const key of Object.keys(good)) {
    const missing = clone(good);
    delete missing[key];
    invalid('start-request.v1', missing, `a request without ${key}`);
  }
  valid('start-request.v1', tweak({ url: 'HTTPS://Example.com/path?x=1' }));
});

test('job.v1: stages are the six pipeline stages in order, each with a state', () => {
  const job = fixture('job-running.json');
  assert.deepEqual(job.stages.map((s) => s.stage), STAGES);
  const swapped = clone(job);
  [swapped.stages[0], swapped.stages[1]] = [swapped.stages[1], swapped.stages[0]];
  invalid('job.v1', swapped, 'stages out of order');
  const short = clone(job);
  short.stages.pop();
  invalid('job.v1', short, 'five stages');
  const long = clone(job);
  long.stages.push({ stage: 'deploy', state: 'pending' });
  invalid('job.v1', long, 'a seventh stage');
  const bad = clone(job);
  bad.stages[2].state = 'queued';
  invalid('job.v1', bad, 'an unknown stage state');
  const extra = clone(job);
  extra.stages[0].note = 'x';
  invalid('job.v1', extra, 'an extra stage field');
});

test('job.v1: id, mode and timestamps have a fixed shape', () => {
  const job = fixture('job-queued.json');
  assert.equal(job.job_id.length, 22);
  for (const id of ['', 'short', `${JOB_ID}x`, `${JOB_ID.slice(0, 21)}+`, `${JOB_ID.slice(0, 21)}=`]) invalid('job.v1', { ...clone(job), job_id: id }, `job_id ${id}`);
  invalid('job.v1', { ...clone(job), mode: 'paid' }, 'mode paid');
  invalid('job.v1', { ...clone(job), created_at: '2026-11-11T10:00:00-08:00' }, 'a local-offset timestamp');
  invalid('job.v1', { ...clone(job), created_at: 'yesterday' }, 'a non-timestamp');
  invalid('job.v1', { ...clone(job), extra: true }, 'an extra field');
});

test('job.v1: each status allows only its own combination of position, times, error and manifest_url', () => {
  const queued = fixture('job-queued.json');
  const running = fixture('job-running.json');
  const done = fixture('job-done.json');
  const failed = fixture('job-failed-crash.json');
  assert.equal(typeof queued.position, 'number');
  assert.equal(running.position, null);
  const cases = [
    ['queued without a position', { ...queued, position: null }],
    ['queued with position 0', { ...queued, position: 0 }],
    ['queued with a start time', { ...queued, started_at: queued.created_at }],
    ['queued with a manifest', { ...queued, manifest_url: done.manifest_url }],
    ['running with a position', { ...running, position: 1 }],
    ['running without a start time', { ...running, started_at: null }],
    ['running with a finish time', { ...running, finished_at: running.started_at }],
    ['running with an error', { ...running, error: failed.error }],
    ['done without a manifest', { ...done, manifest_url: null }],
    ['done with an error', { ...done, error: failed.error }],
    ['done without a finish time', { ...done, finished_at: null }],
    ['done with a position', { ...done, position: 1 }],
    ['failed without an error', { ...failed, error: null }],
    ['failed without a finish time', { ...failed, finished_at: null }],
    ['failed with a manifest', { ...failed, manifest_url: done.manifest_url }],
    ['failed with a position', { ...failed, position: 2 }],
    ['an unknown status', { ...running, status: 'paused' }],
  ];
  for (const [why, data] of cases) invalid('job.v1', clone(data), why);
});

test('job.v1: manifest_url points at the viewer manifest of the same kind of job id', () => {
  const done = fixture('job-done.json');
  assert.equal(done.manifest_url, `${VIEWER}/j/${done.job_id}/manifest.json`);
  invalid('job.v1', { ...clone(done), manifest_url: `${VIEWER}/j/${done.job_id}/run/index.html` }, 'a manifest url that is not manifest.json');
  invalid('job.v1', { ...clone(done), manifest_url: 'javascript:alert(1)' }, 'a javascript url');
  invalid('job.v1', { ...clone(done), manifest_url: `${VIEWER}/j/short/manifest.json` }, 'a short job id in the url');
});

test('job fixtures agree with each other: one job id, mode free, sensible times', () => {
  for (const name of fixtureNames().filter((f) => /^job-/.test(f))) {
    const job = fixture(name);
    assert.equal(job.job_id, JOB_ID, name);
    assert.equal(job.mode, 'free', name);
    if (job.started_at) assert.ok(job.started_at >= job.created_at, `${name}: started before created`);
    if (job.finished_at) assert.ok(job.finished_at >= (job.started_at ?? job.created_at), `${name}: finished before it started`);
    if (job.status === 'done') assert.ok(job.stages.every((s) => s.state === 'done'), `${name}: a done job has a stage that is not done`);
  }
});

test('error fixtures wrap the error in {error: {code, message}} and nothing else', () => {
  for (const code of API_CODES) assert.deepEqual(Object.keys(fixture(`error-${code}.json`)), ['error']);
  invalid('error.v1', { code: 'bad_url', message: fixture('error-bad_url.json').error.message }, 'an unwrapped error');
  invalid('error.v1', { error: fixture('error-bad_url.json').error, status: 400 }, 'an extra field');
});

test('SSE fixtures: ids increase, every event name is known, every data line validates as event.v1', () => {
  for (const name of ['events-done.sse', 'events-failed.sse', 'events-queued.sse']) {
    const events = parseSse(name);
    assert.ok(events.length >= 3, name);
    events.forEach((e, i) => {
      assert.ok(EVENTS.includes(e.event), `${name}: unknown event ${e.event}`);
      assert.equal(e.id, i + 1, `${name}: ids must be 1, 2, 3 and so on`);
      assert.ok(!e.raw.includes('\n'), `${name}: data must be one line`);
      valid('event.v1', e.data);
      valid(`event.v1#/$defs/${e.event}`, e.data);
    });
  }
});

test('SSE fixtures: the event name decides the shape, so a payload under the wrong name is rejected', () => {
  const stage = parseSse('events-done.sse').find((e) => e.event === 'stage');
  invalid('event.v1#/$defs/queued', stage.data, 'a stage payload named queued');
  invalid('event.v1#/$defs/stage', { position: 1 }, 'a queued payload named stage');
  invalid('event.v1', { stage: 'scout', state: 'waiting' }, 'an unknown stage state');
  invalid('event.v1', { stage: 'deploy', state: 'running' }, 'an unknown stage');
  invalid('event.v1', { mode: 'paid' }, 'an unknown mode');
  invalid('event.v1', { position: 0 }, 'position 0');
  invalid('event.v1', { manifest_url: 'http://127.0.0.1:8788/j/x/manifest.json' }, 'a short job id in the url');
  invalid('event.v1', { code: 'crash', message: 'The orchestrator exited with code 1.' }, 'a failure with free text');
  invalid('event.v1', { code: 'bad_url', message: fixture('error-bad_url.json').error.message }, 'an API error code in a failed event');
  invalid('event.v1', {}, 'an empty object');
});

test('events-done.sse tells the whole story: queued, started, six stages running then done, done with the manifest', () => {
  const events = parseSse('events-done.sse');
  assert.deepEqual(events.slice(0, 2).map((e) => e.event), ['queued', 'started']);
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.length, 2 + STAGES.length * 2 + 1);
  const stages = events.filter((e) => e.event === 'stage').map((e) => `${e.data.stage}:${e.data.state}`);
  assert.deepEqual(stages, STAGES.flatMap((s) => [`${s}:running`, `${s}:done`]));
  assert.equal(events.filter((e) => ['done', 'failed'].includes(e.event)).length, 1, 'the stream ends after exactly one closing event');
  assert.equal(events.at(-1).data.manifest_url, fixture('job-done.json').manifest_url);
  assert.deepEqual(events[1].data, { mode: 'free' });
});

test('events-failed.sse ends in failed with a contract message, after the running stage is marked failed', () => {
  const events = parseSse('events-failed.sse');
  assert.equal(events.at(-1).event, 'failed');
  assert.equal(events.filter((e) => ['done', 'failed'].includes(e.event)).length, 1);
  const code = events.at(-1).data.code;
  assert.ok(RUN_CODES.includes(code));
  assert.deepEqual(events.at(-1).data, fixture(`job-failed-${code}.json`).error);
  const last = events.at(-2);
  assert.equal(last.event, 'stage');
  assert.equal(last.data.state, 'failed');
  assert.ok(!events.some((e) => e.event === 'done'));
});

test('events-queued.sse is a stream that is still waiting: queued positions only, falling, never closed', () => {
  const events = parseSse('events-queued.sse');
  assert.ok(events.every((e) => e.event === 'queued'));
  const positions = events.map((e) => e.data.position);
  assert.ok(positions.length >= 2);
  positions.slice(1).forEach((p, i) => assert.ok(p < positions[i], 'the position only falls while waiting'));
  assert.ok(read(join(web, 'fixtures/events-queued.sse')).includes(': ping'), 'carries a comment ping so readers must skip comment lines');
});

// The URLs in manifest.json must be the ones the viewer would build from the sample run's 50-handoff.json and 40-verdict.json.
const ALLOWED_RUN_PREFIXES = ['c-build/site/dist/', 'c-build/screens/', 'b-design/compare.html', 'b-design/previews/', 'b-design/boards/'];
function resolveViewerUrl(url, jobId) {
  const base = `${VIEWER}/j/${jobId}/`;
  assert.ok(url.startsWith(base), `${url} is not under ${base}`);
  return url.slice(base.length);
}

test('manifest.json is built from the sample run: every run URL maps to a file that exists in an allowed folder', () => {
  const m = fixture('manifest.json');
  const handoff = readJson(join(sample, '50-handoff.json'));
  const verdict = readJson(join(sample, '40-verdict.json'));
  assert.equal(m.job_id, JOB_ID);
  const fileFor = (url) => {
    const rel = resolveViewerUrl(url, m.job_id);
    assert.ok(rel.startsWith('run/'), `${url} is not a run file`);
    const path = rel.slice('run/'.length);
    assert.ok(ALLOWED_RUN_PREFIXES.some((p) => path === p || (p.endsWith('/') && path.startsWith(p))), `${path} is outside the allowed folders`);
    assert.ok(!path.split('/').includes('..'), path);
    assert.ok(existsSync(join(sample, path)), `${path} does not exist in contracts/fixtures/sample/`);
    return path;
  };
  assert.deepEqual(m.site.pages.map((p) => p.slug), handoff.site.pages.map((p) => p.slug));
  m.site.pages.forEach((page, i) => {
    const src = handoff.site.pages[i];
    assert.equal(fileFor(page.url), src.path, `${page.slug} url`);
    assert.equal(fileFor(page.screenshots.desktop), src.screenshots.desktop);
    assert.equal(fileFor(page.screenshots.mobile), src.screenshots.mobile);
  });
  assert.equal(m.site.home_url, m.site.pages.find((p) => p.slug === 'home').url);
  assert.equal(fileFor(m.compare_url), verdict.compare_path);
  assert.equal(resolveViewerUrl(m.report_url, m.job_id), 'report.md');
  assert.ok(existsSync(join(sample, handoff.report_path)), 'the report the viewer serves exists in the sample run');
  assert.equal(resolveViewerUrl(m.bundle_url, m.job_id), 'bundle.tar.gz');
  assert.deepEqual(m.gates, { passed: handoff.qa.gates_passed, axe_serious: handoff.qa.axe.serious, axe_critical: handoff.qa.axe.critical });
  assert.deepEqual(m.fidelity, { pages_carried: handoff.fidelity.pages_carried, pages_total: handoff.fidelity.pages_total });
});

test('manifest-no-bundle.json is the same manifest with bundle_url null, and nothing else differs', () => {
  const withBundle = fixture('manifest.json');
  const without = fixture('manifest-no-bundle.json');
  assert.equal(without.bundle_url, null);
  assert.deepEqual({ ...withBundle, bundle_url: null }, without);
});

test('manifest.v1 rejects URLs that leave the viewer layout, missing keys and extra keys', () => {
  const good = fixture('manifest.json');
  const mutate = (fn) => {
    const m = clone(good);
    fn(m);
    return m;
  };
  invalid('manifest.v1', mutate((m) => { m.site.pages[0].url = 'javascript:alert(1)'; }), 'a javascript page url');
  invalid('manifest.v1', mutate((m) => { m.site.pages[0].url = `${VIEWER}/j/${JOB_ID}/a-scout/10-inventory.json`; }), 'a url outside /run/');
  invalid('manifest.v1', mutate((m) => { m.site.pages[0].url = `${VIEWER}/j/${JOB_ID}/run/../a-scout/10-inventory.json`; }), 'a dot dot path');
  invalid('manifest.v1', mutate((m) => { m.compare_url = `${VIEWER}/j/${JOB_ID}/run/b-design/../a-scout/failure.json`; }), 'a dot dot path in the middle');
  invalid('manifest.v1', mutate((m) => { m.site.pages[0].screenshots.mobile = `${VIEWER}/j/${JOB_ID}/run/c-build/screens/a b.png`; }), 'a url with a space');
  invalid('manifest.v1', mutate((m) => { m.report_url = `${VIEWER}/j/${JOB_ID}/run/c-build/report.md`; }), 'a report url through /run/');
  invalid('manifest.v1', mutate((m) => { m.bundle_url = `${VIEWER}/j/${JOB_ID}/bundle.zip`; }), 'a zip bundle');
  invalid('manifest.v1', mutate((m) => { m.site.pages = []; }), 'no pages');
  invalid('manifest.v1', mutate((m) => { m.site.pages[0].slug = 'Home Page'; }), 'a bad slug');
  invalid('manifest.v1', mutate((m) => { m.gates.passed = 'yes'; }), 'gates.passed as a string');
  invalid('manifest.v1', mutate((m) => { m.gates.axe_serious = -1; }), 'negative axe count');
  invalid('manifest.v1', mutate((m) => { m.fidelity.pages_total = 1.5; }), 'a fractional page count');
  invalid('manifest.v1', mutate((m) => { m.extra = 1; }), 'an extra key');
  invalid('manifest.v1', mutate((m) => { delete m.compare_url; }), 'a missing compare_url');
  invalid('manifest.v1', mutate((m) => { delete m.bundle_url; }), 'a missing bundle_url (it must be explicit, null when there is none)');
  invalid('manifest.v1', mutate((m) => { m.job_id = 'short'; }), 'a short job id');
});

test('every URL in every fixture uses the viewer origin on 127.0.0.1:8788, never a scraped or external host', () => {
  for (const name of fixtureNames()) {
    const urls = read(join(web, 'fixtures', name)).match(/https?:\/\/[^"\s\\]+/g) ?? [];
    for (const u of urls) {
      if (name === 'start-request.json' || name.startsWith('error-')) continue;
      assert.ok(u.startsWith(`${VIEWER}/j/`), `${name}: ${u}`);
    }
  }
});

test('the README documents every route, every code and every fixture', () => {
  const readme = read(join(web, 'README.md'));
  for (const route of ['POST /api/jobs', 'GET /api/jobs/:job_id', 'GET /api/jobs/:job_id/events', '/j/:job_id/manifest.json', '/j/:job_id/run/', '/j/:job_id/report.md', '/j/:job_id/bundle.tar.gz']) {
    assert.ok(readme.includes(route), `README lacks route ${route}`);
  }
  for (const code of [...API_CODES, ...RUN_CODES]) assert.ok(readme.includes(`\`${code}\``), `README lacks code ${code}`);
  for (const name of fixtureNames().filter((f) => !/^(error|job-failed)-/.test(f))) assert.ok(readme.includes(name), `README lacks fixture ${name}`);
  for (const pattern of ['error-<code>.json', 'job-failed-<code>.json']) assert.ok(readme.includes(pattern), `README lacks fixture pattern ${pattern}`);
  assert.ok(readme.includes('contracts-web-v1.0.0'));
  assert.ok(readme.includes('plan/lanes.md'), 'README points at the contract change-request rule');
});

test('the README table gives each code its fixed message word for word and its HTTP status', () => {
  const status = { bad_request: 400, bad_url: 400, host_not_public: 400, owner_name_required: 400, consent_required: 400, invite_invalid: 403, invite_used_today: 429, daily_cap_reached: 503, queue_full: 503, not_found: 404 };
  const rows = new Map(read(join(web, 'README.md')).split(/\r?\n/).filter((l) => /^\| `[a-z_]+` \| (\d{3}|none) \| `/.test(l) && l.split('|').length >= 6).map((l) => {
    const cells = l.split('|').map((c) => c.trim());
    return [cells[1].replaceAll('`', ''), { http: cells[2], message: cells[4] }];
  }));
  for (const code of API_CODES) {
    assert.equal(rows.get(code)?.message, fixture(`error-${code}.json`).error.message, `README message for ${code}`);
    assert.equal(rows.get(code)?.http, String(status[code]), `README status for ${code}`);
  }
  for (const code of RUN_CODES) {
    assert.equal(rows.get(code)?.message, fixture(`job-failed-${code}.json`).error.message, `README message for ${code}`);
    assert.equal(rows.get(code)?.http, 'none', `README status for ${code}`);
  }
});

test('the README rule table lists the nine start-request checks in order with the right code and HTTP status', () => {
  const expected = [['bad_request', '400'], ['bad_url', '400'], ['owner_name_required', '400'], ['consent_required', '400'], ['invite_invalid', '403'], ['invite_used_today', '429'], ['daily_cap_reached', '503'], ['host_not_public', '400'], ['queue_full', '503']];
  const rows = read(join(web, 'README.md')).split(/\r?\n/).filter((l) => /^\| \d \| /.test(l)).map((l) => l.split('|').map((c) => c.trim()));
  assert.deepEqual(rows.map((c) => Number(c[1])), expected.map((_, i) => i + 1));
  assert.deepEqual(rows.map((c) => [c[3].replaceAll('`', ''), c[4]]), expected);
});

test('no em or en dash in anything under contracts/web, .sse files included', () => {
  const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  for (const f of walk(web)) assert.ok(!dashes.some((d) => read(f).includes(d)), f);
});

test('the web folder holds only schemas, fixtures and the README, and every fixture file ends with a newline', () => {
  const top = readdirSync(web).sort();
  assert.deepEqual(top, ['README.md', 'fixtures', 'schemas']);
  for (const f of walk(join(web, 'fixtures'))) assert.ok(read(f).endsWith('\n'), `${f} lacks a final newline`);
});
