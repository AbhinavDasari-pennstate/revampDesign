import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ci = readFileSync(join(import.meta.dirname, '../../workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');

// Job name -> its text: from "  name:" (two spaces) under `jobs:` to the next job. No YAML parser is installed, so this reads the file as text.
function jobs(text) {
  const out = {};
  let name = null;
  let inJobs = false;
  for (const line of text.split('\n')) {
    if (line === 'jobs:') inJobs = true;
    else if (inJobs) {
      const m = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
      if (m) {
        name = m[1];
        out[name] = [];
      } else if (name) out[name].push(line);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}
const all = jobs(ci);
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('the jobs that were there before are still there', () => {
  for (const name of ['lane-guard', 'b-design', 'contracts', 'orchestrator', 'a-scout', 'c-build']) assert.ok(all[name], `${name} job is gone`);
});

for (const folder of ['server', 'ui', 'viewer']) {
  test(`web-${folder}: runs its tests once web/${folder}/test exists and says so while it does not`, () => {
    const job = all[`web-${folder}`];
    assert.ok(job, `no web-${folder} job`);
    assert.ok(job.includes('actions/checkout@v4'));
    assert.ok(job.includes('actions/setup-node@v4'));
    assert.ok(job.includes('node-version-file: .nvmrc'));
    // A block scalar: a plain YAML scalar cannot hold ": " and the echo line may one day.
    assert.ok(/- run: \|\n/.test(job), 'the run step must be a block scalar');
    assert.ok(job.includes(`if [ -d web/${folder}/test ]; then`));
    assert.ok(job.includes(`cd web/${folder} && node --test`));
    assert.ok(job.includes(`echo "web/${folder} has no tests yet"`));
    assert.ok(job.includes('\n          fi'), 'the if must be closed');
  });
}

test('the web jobs install nothing: web/ has no dependencies and Playwright for web-viewer waits for its tests', () => {
  for (const folder of ['server', 'ui', 'viewer']) {
    const job = code(all[`web-${folder}`]);
    assert.ok(!/npm (ci|install)|playwright install/.test(job), `web-${folder} installs something`);
  }
  const viewer = all['web-viewer'];
  assert.ok(/#.*Playwright/.test(viewer) && /#.*lanes\/c-build/.test(viewer), 'web-viewer carries a comment about Playwright from lanes/c-build');
});

test('the old "no tests yet" comment is gone and the file has no em or en dash', () => {
  assert.ok(!ci.includes('have no tests yet (plan/web-plan.md T40 to T42)'));
  assert.ok(![0x2013, 0x2014].some((c) => ci.includes(String.fromCharCode(c))));
});
