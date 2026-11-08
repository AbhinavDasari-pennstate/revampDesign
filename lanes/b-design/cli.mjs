#!/usr/bin/env node
// Lane B stage CLI. Exit codes: 0 ok, 1 crash or usage, 2 bad input, 3 quality gate failed (output written), 4 budget.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { art } from './art/directions.mjs';
import { renderPreviews } from './art/board.mjs';
import { writeCompare } from './council/compare.mjs';
import { council } from './council/council.mjs';
import { learn } from './council/learn.mjs';
import { check } from './lib/contracts.mjs';
import { ask, BudgetError } from './lib/openrouter.mjs';
import { scrub, story } from './story/story.mjs';

const USAGE = `usage: node lanes/b-design/cli.mjs <story|art|council> --run <dir> --in <file> [--in <file> ...] --out <file> [--max-usd <n>] [--live] [--no-images]
       node lanes/b-design/cli.mjs learn --in <run>/45-selection.json [--in ...] [--out <file.jsonl>]`;
const NEEDS = { story: ['run', 'inventory'], art: ['run', 'inventory', 'storyboard'], council: ['directions'] };
const OPTIONS = { run: { type: 'string' }, in: { type: 'string', multiple: true }, out: { type: 'string' }, 'max-usd': { type: 'string' }, live: { type: 'boolean' }, 'no-images': { type: 'boolean' } };

const fail = (code, msg) => { console.error(msg); return code; };

async function main(argv) {
  const [stage, ...rest] = argv;
  if (!NEEDS[stage] && stage !== 'learn') return fail(1, `unknown stage "${stage ?? ''}"\n${USAGE}`);
  let opts;
  let extra;
  // learn takes bare paths too, so a shell glob like --in runs/*/45-selection.json works.
  try { ({ values: opts, positionals: extra } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: stage === 'learn' })); } catch (e) { return fail(1, `${e.message}\n${USAGE}`); }

  if (stage === 'learn') {
    try { console.log(`learn: ${learn([...(opts.in ?? []), ...extra], opts.out).length} new rows`); return 0; } catch (e) { return fail(e.exit ?? 1, e.message); }
  }

  let maxUsd;
  if (opts['max-usd'] !== undefined) {
    maxUsd = Number(opts['max-usd']);
    if (Number.isNaN(maxUsd)) return fail(1, `--max-usd must be a number\n${USAGE}`);
    if (maxUsd <= 0) return fail(4, `${stage}: budget cap is ${maxUsd} USD, nothing was spent and no output was written`);
  }
  if (!opts.run || !opts.out) return fail(1, `--run and --out are required\n${USAGE}`);

  const by = {};
  for (const file of opts.in ?? []) {
    if (!existsSync(file)) return fail(2, `${file}: file not found`);
    let doc;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return fail(2, `${file}: not valid JSON (${e.message})`); }
    const err = check(doc);
    if (err) return fail(2, `${file}: fails its schema: ${err}`);
    by[doc.contract] = doc;
  }
  for (const need of NEEDS[stage]) if (!by[need]) return fail(2, `${stage} needs --in <${need} file>`);
  const ids = new Set(Object.values(by).map((d) => d.run_id));
  if (ids.size > 1) return fail(2, `inputs come from different runs: ${[...ids].join(', ')}`);

  try { process.loadEnvFile(join(import.meta.dirname, '.env')); } catch {}
  const models = JSON.parse(readFileSync(join(import.meta.dirname, 'models.json'), 'utf8'));
  // --max-usd caps this stage. Otherwise the run's Lane B cap is shared by story, art and council: what earlier
  // stages logged in b-design/cost.jsonl is subtracted. council has no run input, so it reads R/00-run.json.
  const costLog = join(opts.run, 'b-design', 'cost.jsonl');
  const runFile = join(opts.run, '00-run.json');
  const runDoc = by.run ?? (existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : null);
  const cost = (line) => { try { return JSON.parse(line).cost_usd ?? 0; } catch { console.error(`skipping a broken line in ${costLog}`); return 0; } };
  const spentBefore = existsSync(costLog) ? readFileSync(costLog, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + cost(l), 0) : 0;
  const budget = { max: maxUsd ?? (runDoc?.limits?.lane_budget_usd?.b ?? Infinity) - spentBefore, spent: 0 };
  const live = Boolean(opts.live);
  const askFn = (args) => ask({ ...args, budget });

  let result;
  try {
    if (stage === 'story') result = await story({ run: by.run, inventory: by.inventory, ask: askFn, live, models });
    if (stage === 'art') {
      result = await art({ run: by.run, inventory: by.inventory, storyboard: by.storyboard, ask: askFn, live, models });
      // Previews go to vision judges, so the board text is scrubbed of person names like any model payload.
      await renderPreviews(opts.run, result.doc.directions, scrub(by.storyboard, by.inventory), { webFonts: !process.env.B_NO_WEB_FONTS });
    }
    if (stage === 'council') {
      result = await council({ runDir: opts.run, directions: by.directions, ask: askFn, live, models, budget });
      writeCompare(opts.run, by.directions, result.doc);
    }
  } catch (e) {
    // ponytail: Lane B contracts have no status field, so a budget stop writes no output file (exit 4 says why).
    if (e instanceof BudgetError) return fail(4, `${stage}: ${e.message}. No output written.`);
    if (e.exit) return fail(e.exit, `${stage}: ${e.message}`);
    throw e;
  } finally {
    if (live) {
      mkdirSync(join(opts.run, 'b-design'), { recursive: true });
      appendFileSync(join(opts.run, 'b-design', 'cost.jsonl'), `${JSON.stringify({ stage, cost_usd: budget.spent, at: new Date().toISOString() })}\n`);
    }
  }

  const err = check(result.doc);
  // A gate failure that also breaks the schema (for example a site with no text at all) cannot be written.
  if (err && result.problems.length) return fail(3, `${stage}: quality gate failed, no valid output possible:\n- ${result.problems.join('\n- ')}`);
  if (err) return fail(1, `${stage}: produced an invalid ${result.doc.contract} file (a Lane B bug): ${err}`);
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(result.doc, null, 2)}\n`);
  if (result.problems.length) return fail(3, `${stage}: quality gate failed, output written to ${opts.out}:\n- ${result.problems.join('\n- ')}`);
  console.log(`${stage}: wrote ${opts.out}${live ? ` (cost ${budget.spent.toFixed(4)} USD)` : ''}`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack ?? e); process.exitCode = 1; });
