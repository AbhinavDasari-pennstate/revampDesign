// A stand-in for orchestrator/cli.mjs, so the server tests never run a real crawl.
// Same command line as the real one: node fake-orchestrator.mjs run --url <u> --tier B --consent-note <text> --out-dir <dir> [--live]
// What it does is chosen per job by the query string of --url (the server passes the address through unchanged):
//   ?sleep=<ms>   wait this long before finishing (default 0)
//   ?exit=<code>  exit with this code (default 0); contract files are written only for exit 0
//   ?child=1      also start a grandchild (it ends by itself after 2 minutes) and write its pid to <out-dir>/fake-grandchild.pid (proves the whole tree is killed)
//   ?noise=1      print one marker line to stdout and one to stderr (proves console output stays in console.log) and put one in orchestrator.log (proves no run output reaches a response)
//   ?vcost=<x>    cost_usd written into 40-verdict.json (lane B's spend), and ?hcost=<x> into 50-handoff.json (lane C's); a value that is not a number is written as text, and str:<x> writes a numeric string such as "3"
//   ?costlog=<s>  write <run>/b-design/cost.jsonl like lane B does: story:1.2,art:2.7,council:0.1 (see writeCostLog for the broken variants)
//   ?files=1      write the contract files also when the exit code is not 0 (a run that spent money and then crashed)
//   ?gate=1       after the sleep, wait until the file <out-dir>/go exists (the test releases the job, so a line of jobs can be set up without racing)
//   ?upto=<n>     write only the first n of the six stage files (10-inventory.json to 50-handoff.json), also when the exit code is not 0: a run that stopped at stage n + 1
//   ?steps=1      before writing stage file i (1 to 6) wait until the file <out-dir>/step-<i> exists, so a test sees each stage in turn without racing the poller
//   ?stub=1       the log says STUB <stage> (lane not present) for the five lane stages, like a real run whose lane CLIs are missing
//   ?nolog=1      write no orchestrator.log at all
//   ?failstage=<stage>  the stage the FAILED line of the log names (default: the first stage whose file was not written, or build when all six were). Lanes B and C write
//                 their output file and then exit 3 when a quality gate fails, so ?exit=3&upto=3&failstage=art is a run whose art stage left its file and still failed
//   ?lag=<ms>     after the last stage file is written, wait this long before the log and the exit: a lane whose process takes a while to end after it wrote its file (Lane B exits when its loop drains)
// Files it leaves next to the run folder, for the tests: fake-timing.json {start, end} in ms, fake-grandchild.pid.
// The run folder is <out-dir>/<run_id>/ with the contract files copied from contracts/fixtures/sample/ (no stage folders), like the real stub mode.
// Like the real orchestrator it ends by writing <run folder>/orchestrator.log: one line `ok <stage> <file>` per stage file it wrote, STUB lines for ?stub=1, a FAILED line on a non zero exit.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `node --test` also runs every file under test/ as a test file, with no arguments at all: do nothing there, so that counts as a pass.
if (process.argv.length <= 2) process.exit(0);

const sample = fileURLToPath(new URL('../../../contracts/fixtures/sample/', import.meta.url));
const FILES = ['00-run.json', '10-inventory.json', '20-storyboard.json', '30-directions.json', '40-verdict.json', '45-selection.json', '50-handoff.json'];
const STAGE_NAMES = ['scout', 'story', 'art', 'council', 'select', 'build'];

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
// Lane B's b-design/cost.jsonl: one line {stage, cost_usd, at} per stage. ?costlog=story:1.2,art:2.7 writes those lines ("" writes an empty file);
// stage:missing leaves cost_usd out, stage:abc or stage:"3" writes it as text, junk writes a line that is not JSON, dir makes cost.jsonl a folder.
function writeCostLog(spec) {
  const folder = join(runDir, 'b-design');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'cost.jsonl');
  if (spec === 'dir') return mkdirSync(file);
  const lines = spec === '' ? [] : spec.split(',').map((item) => {
    if (item === 'junk') return '{not json';
    const [stage, value] = item.split(':');
    const quoted = /^"(.*)"$/.exec(value); // stage:"3" writes the text "3", not the number
    const spent = value === 'missing' ? {} : quoted ? { cost_usd: quoted[1] } : { cost_usd: value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value };
    return JSON.stringify({ stage, ...spent, at: '2026-11-11T20:00:00.000Z' });
  });
  writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
}
if ((exitCode === 0 || query.get('files') === '1') && query.get('costlog') !== null) writeCostLog(query.get('costlog'));
const upto = query.has('upto') ? Number(query.get('upto')) : exitCode === 0 || query.get('files') === '1' ? 6 : 0;
const log = [];
for (let i = 0; i < upto; i++) {
  if (query.get('steps') === '1') while (!existsSync(join(outDir, `step-${i + 1}`))) await new Promise((resolve) => setTimeout(resolve, 20));
  const name = FILES[i + 1];
  const doc = JSON.parse(readFileSync(join(sample, name), 'utf8'));
  const spent = name === '40-verdict.json' ? cost('vcost') : name === '50-handoff.json' ? cost('hcost') : {};
  writeFileSync(join(runDir, name), JSON.stringify({ ...doc, run_id: runId, ...spent }, null, 2));
  if (query.get('stub') === '1' && STAGE_NAMES[i] !== 'select') log.push(`STUB ${STAGE_NAMES[i]} (lane not present)`);
  log.push(`ok ${STAGE_NAMES[i]} ${name}`);
}
if (query.has('lag')) await new Promise((resolve) => setTimeout(resolve, Number(query.get('lag')))); // the files are there, the process lingers
if (query.get('noise') === '1') log.push('SECRET-LOG-MARKER');
if (exitCode !== 0) log.push(`FAILED stage ${query.get('failstage') ?? STAGE_NAMES[Math.min(upto, 5)]} failed with exit ${exitCode} SECRET-LOG-MARKER`);
if (query.get('nolog') !== '1') writeFileSync(join(runDir, 'orchestrator.log'), log.join('\n') + '\n');
writeFileSync(join(outDir, 'fake-timing.json'), JSON.stringify({ start, end: Date.now() }));
process.exit(exitCode);
