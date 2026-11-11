import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, crossErrors, schemaErrors } from '../../contracts/validate.mjs';
import { writeSelection } from './select.mjs';

const COPIED = ['inventory', 'storyboard', 'directions', 'verdict', 'handoff'];
const FOLDERS = ['a-scout', 'b-design', 'c-build'];
// stage name, contract file it produces, lane folder that owns it, contract files it reads
const STAGES = [
  ['scout', 'inventory', 'a-scout', ['run']],
  ['story', 'storyboard', 'b-design', ['run', 'inventory']],
  ['art', 'directions', 'b-design', ['run', 'inventory', 'storyboard']],
  ['council', 'verdict', 'b-design', ['directions']],
  ['select', 'selection'],
  ['build', 'handoff', 'c-build', ['run', 'inventory', 'storyboard', 'directions', 'selection']],
];
const OWNERS = { 'a-scout': 'Abhinav', 'b-design': 'Nirmal', 'c-build': 'Aditya' };
const EXIT_MEANING = { 1: 'crash', 2: 'input failed its schema', 3: 'quality gate failed', 4: 'budget cap hit' };

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });
const stampOf = (now) => now.toISOString().replace(/[-:]/g, '').replace(/^(\d{8})T(\d{4}).*/, '$1-$2');

// A run in the same minute must not reuse a run folder: take the next free suffix (-2, -3, ...).
function newRunDir(outDir, base) {
  mkdirSync(outDir, { recursive: true });
  for (let n = 1; ; n++) {
    const runId = n === 1 ? base : `${base}-${n}`;
    try {
      mkdirSync(join(outDir, runId));
      return runId;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// Stub mode: copy the fixture into a new run folder. Never looks in lanes/.
export function runStub({ fixture, outDir, now = new Date() }) {
  for (const name of [FILES.run, ...COPIED.map((k) => FILES[k])]) {
    if (!existsSync(join(fixture, name))) throw fail(`fixture is missing ${join(fixture, name)}`, 1);
  }
  const run = readJson(join(fixture, FILES.run));
  const runId = newRunDir(outDir, `${stampOf(now)}-${run.site_slug}`);
  const runDir = join(outDir, runId);

  for (const key of COPIED) cpSync(join(fixture, FILES[key]), join(runDir, FILES[key]));
  for (const folder of FOLDERS) if (existsSync(join(fixture, folder))) cpSync(join(fixture, folder), join(runDir, folder), { recursive: true });
  writeJson(join(runDir, FILES.run), { ...run, run_id: runId, created_at: now.toISOString() });
  for (const key of COPIED) writeJson(join(runDir, FILES[key]), { ...readJson(join(runDir, FILES[key])), run_id: runId });

  const lines = [];
  for (const [stage, key] of STAGES) {
    if (stage === 'select') writeSelection(runDir, runId, now);
    const errors = schemaErrors(readJson(join(runDir, FILES[key])));
    if (errors.length) throw fail(`${FILES[key]} failed its schema:\n${errors.join('\n')}`, 2);
    lines.push(`STUB ${stage} ok ${FILES[key]}`);
  }
  const cross = crossErrors(runDir);
  if (cross.length) throw fail(`run folder failed the cross check:\n${cross.join('\n')}`, 2);
  writeFileSync(join(runDir, 'orchestrator.log'), lines.join('\n') + '\n');
  return { runId, runDir, lines };
}

// Stage CLIs run on this same Node, and Lane C's build needs the .nvmrc version. A warning, so the stages that do not need it still run.
export function nodeNote(version, wanted) {
  const [have, want] = [parseInt(version, 10), parseInt(String(wanted).trim().replace(/^v/, ''), 10)];
  return have < want ? `Warning: running on Node ${have}, the project needs Node ${want} (.nvmrc). Stages may fail.` : null;
}

// Real mode: run each lane CLI in order; a lane whose CLI is missing is filled from the fixture.
export function runReal({ url, tier, outDir, lanesRoot, fixture, pick, consentNote, live = false, now = new Date(), nodeVersion = process.versions.node }) {
  if (pick !== undefined && !/^d[123]$/.test(pick)) throw fail(`--pick must be d1, d2 or d3, got ${pick}`, 2);
  if (!['A', 'B', 'C'].includes(tier)) throw fail(`--tier must be A, B or C, got ${tier}`, 2);
  let host;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('not http');
    host = u.hostname;
  } catch {
    throw fail(`--url must be an http or https URL, got ${url}`, 2);
  }
  const template = readJson(join(fixture, FILES.run));
  const consent = consentNote?.trim() ? { owner_ok: true, note: consentNote.trim() } : { owner_ok: false, note: 'No owner consent recorded for this run.' };
  const siteSlug = host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const runId = newRunDir(outDir, `${stampOf(now)}-${siteSlug}`);
  const runDir = join(outDir, runId);
  const lines = [];
  // Every exit path leaves the log so far, failure line included.
  try {
    return executeReal({ url, tier, runDir, runId, template, consent, siteSlug, lanesRoot, fixture, pick, live, now, nodeVersion, lines });
  } catch (e) {
    lines.push(`FAILED ${e.message}`);
    writeFileSync(join(runDir, 'orchestrator.log'), lines.join('\n') + '\n');
    throw e;
  }
}

function executeReal({ url, tier, runDir, runId, template, consent, siteSlug, lanesRoot, fixture, pick, live, now, nodeVersion, lines }) {
  const runDoc = { ...template, run_id: runId, consent, source_url: url, site_slug: siteSlug, tier, created_at: now.toISOString() };
  writeJson(join(runDir, FILES.run), runDoc);
  const runErrors = schemaErrors(runDoc);
  if (runErrors.length) throw fail(`${FILES.run} failed its schema:\n${runErrors.join('\n')}`, 2);

  let wanted; // no .nvmrc means nothing to compare against, never a failed run
  try {
    wanted = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8');
  } catch {}
  const note = nodeNote(nodeVersion, wanted);
  if (note) {
    console.error(note);
    lines.push(note);
  }
  let stubbed = 0;
  for (const [stage, key, lane, inputs] of STAGES) {
    const out = join(runDir, FILES[key]);
    const cli = lane && join(lanesRoot, lane, 'cli.mjs');
    if (stage === 'select') {
      if (writeSelection(runDir, runId, now, pick) && !pick) {
        lines.push('select: the council says this needs a human; using its top pick. Override with --pick d1, d2 or d3');
      }
    } else if (existsSync(cli)) {
      const ins = inputs.map((k) => join(runDir, FILES[k]));
      const args = [cli, stage, '--run', runDir, ...ins.flatMap((f) => ['--in', f]), '--out', out];
      // --live turns on Lane B's paid models (story, art, council); Scout and build never take it.
      if (live && lane === 'b-design') args.push('--live');
      const { status } = spawnSync(process.execPath, args, { stdio: 'inherit' });
      if (status !== 0) {
        const code = status ?? 1;
        throw fail(`stage ${stage} failed with exit ${code} (${EXIT_MEANING[code] ?? 'unexpected exit'}). Owner: ${OWNERS[lane]} (${lane}). Inputs: ${ins.join(', ')}`, code);
      }
    } else {
      cpSync(join(fixture, FILES[key]), out);
      if (existsSync(join(fixture, lane))) cpSync(join(fixture, lane), join(runDir, lane), { recursive: true });
      writeJson(out, { ...readJson(out), run_id: runId });
      stubbed++;
      lines.push(`STUB ${stage} (lane not present)`);
    }
    if (!existsSync(out)) throw fail(`stage ${stage} wrote no ${FILES[key]}`, 2);
    let doc;
    try {
      doc = readJson(out);
    } catch {
      throw fail(`stage ${stage} wrote ${out} which is not valid JSON. Owner: ${OWNERS[lane] ?? 'Abhinav'} (${lane ?? 'orchestrator'})`, 2);
    }
    if (doc?.contract !== key) throw fail(`stage ${stage} wrote ${FILES[key]} declaring contract ${doc?.contract}, expected ${key}`, 2);
    const errors = schemaErrors(doc);
    if (errors.length) throw fail(`${FILES[key]} failed its schema:\n${errors.join('\n')}`, 2);
    lines.push(`ok ${stage} ${FILES[key]}`);
  }
  // 5 lane stages; stand-in files carry sample ids, so a mixed run cannot pass the cross check.
  if (stubbed > 0 && stubbed < 5) {
    lines.push('CROSS skipped (mixed real and stub stages)');
  } else {
    const cross = crossErrors(runDir);
    if (cross.length) throw fail(`run folder failed the cross check:\n${cross.join('\n')}`, 2);
  }
  writeFileSync(join(runDir, 'orchestrator.log'), lines.join('\n') + '\n');
  return { runId, runDir, lines };
}
