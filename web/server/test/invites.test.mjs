// Tests for invite codes (plan/web-plan.md T47): how the server uses the invite store (rules 5 and 6), the store itself (invites.mjs) and the admin tool (admin.mjs).
// Never a network call and never a paid model: the orchestrator is the fake one from test/fake-orchestrator.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertError, assertJob, cleanup, finished, getJob, oneUse, post, request, startApp } from './harness.mjs';

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
