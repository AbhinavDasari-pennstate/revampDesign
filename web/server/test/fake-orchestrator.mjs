// A stand-in for orchestrator/cli.mjs, so the server tests never run a real crawl.
// Same command line as the real one: node fake-orchestrator.mjs run --url <u> --tier B --consent-note <text> --out-dir <dir> [--live]
// What it does is chosen per job by the query string of --url (the server passes the address through unchanged):
//   ?sleep=<ms>   wait this long before finishing (default 0)
//   ?exit=<code>  exit with this code (default 0); contract files are written only for exit 0
//   ?child=1      also start a grandchild (it ends by itself after 2 minutes) and write its pid to <out-dir>/fake-grandchild.pid (proves the whole tree is killed)
//   ?noise=1      print one marker line to stdout and one to stderr (proves console output stays in console.log)
//   ?vcost=<x>    cost_usd written into 40-verdict.json (lane B's spend), and ?hcost=<x> into 50-handoff.json (lane C's); a value that is not a number is written as text, and str:<x> writes a numeric string such as "3"
//   ?files=1      write the contract files also when the exit code is not 0 (a run that spent money and then crashed)
//   ?gate=1       after the sleep, wait until the file <out-dir>/go exists (the test releases the job, so a line of jobs can be set up without racing)
// Files it leaves next to the run folder, for the tests: fake-timing.json {start, end} in ms, fake-grandchild.pid.
// The run folder is <out-dir>/<run_id>/ with the contract files copied from contracts/fixtures/sample/ (no stage folders), like the real stub mode.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `node --test` also runs every file under test/ as a test file, with no arguments at all: do nothing there, so that counts as a pass.
if (process.argv.length <= 2) process.exit(0);

const sample = fileURLToPath(new URL('../../../contracts/fixtures/sample/', import.meta.url));
const FILES = ['00-run.json', '10-inventory.json', '20-storyboard.json', '30-directions.json', '40-verdict.json', '45-selection.json', '50-handoff.json'];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { url: { type: 'string' }, tier: { type: 'string' }, 'consent-note': { type: 'string' }, 'out-dir': { type: 'string' }, live: { type: 'boolean' } },
});
if (positionals[0] !== 'run' || positionals.length !== 1) throw new Error('fake orchestrator: expected the single word "run"');

const outDir = values['out-dir'];
const query = new URL(values.url).searchParams;
const sleepMs = Number(query.get('sleep') ?? 0);
const exitCode = Number(query.get('exit') ?? 0);

console.log('FAKE-ARGV ' + JSON.stringify(process.argv.slice(2)));
if (query.get('noise') === '1') {
  console.log('SECRET-STDOUT-MARKER');
  console.error('SECRET-STDERR-MARKER');
}

const start = Date.now();
const runId = 'fake-run-1';
const runDir = join(outDir, runId);
mkdirSync(runDir, { recursive: true });
const run = JSON.parse(readFileSync(join(sample, '00-run.json'), 'utf8'));
writeFileSync(join(runDir, '00-run.json'), JSON.stringify({ ...run, run_id: runId, source_url: values.url, consent: { owner_ok: true, note: values['consent-note'] } }, null, 2));

if (query.get('child') === '1') {
  // On Windows node puts its children in a job object that dies with the parent, so the grandchild breaks away from it: only taskkill /T can reach it then.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });
  writeFileSync(join(outDir, 'fake-grandchild.pid'), String(child.pid));
}

await new Promise((resolve) => setTimeout(resolve, sleepMs));
if (query.get('gate') === '1') while (!existsSync(join(outDir, 'go'))) await new Promise((resolve) => setTimeout(resolve, 20));

const cost = (param) => {
  const text = query.get(param);
  if (text === null) return {};
  if (text.startsWith('str:')) return { cost_usd: text.slice(4) }; // a number written as text: "3"
  return { cost_usd: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text };
};
if (exitCode === 0 || query.get('files') === '1') {
  for (const name of FILES.slice(1)) {
    const doc = JSON.parse(readFileSync(join(sample, name), 'utf8'));
    const spent = name === '40-verdict.json' ? cost('vcost') : name === '50-handoff.json' ? cost('hcost') : {};
    writeFileSync(join(runDir, name), JSON.stringify({ ...doc, run_id: runId, ...spent }, null, 2));
  }
}
writeFileSync(join(outDir, 'fake-timing.json'), JSON.stringify({ start, end: Date.now() }));
process.exit(exitCode);
