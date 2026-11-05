// Lane C stage CLI (plan/plan.md "Interfaces"):
//   node lanes/c-build/cli.mjs build --run R --in R/00-run.json --in R/10-inventory.json --in R/20-storyboard.json
//     --in R/30-directions.json --in R/45-selection.json --out R/50-handoff.json [--max-usd <n>]
// Exit 0 ok, 1 crash, 2 input failed its schema, 3 quality gate failed, 4 budget cap hit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildPages } from './builder/pages.mjs';
import { noDashes, noDashesDeep } from './builder/text.mjs';
import { fidelity } from './handoff/fidelity.mjs';
import { ownerReport } from './handoff/report.mjs';
import { makeRepo } from './handoff/repo.mjs';
import { takeScreens } from './handoff/screens.mjs';
import { fail, readContract, schemaErrors } from './lib/contracts.mjs';
import { checkA11y } from './qa/a11y.mjs';
import { factDiff } from './qa/factdiff.mjs';
import { checkLinks } from './qa/links.mjs';

const NEEDS = ['run', 'inventory', 'storyboard', 'directions', 'selection'];

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { run: { type: 'string' }, in: { type: 'string', multiple: true }, out: { type: 'string' }, 'max-usd': { type: 'string' } },
    });
  } catch (e) {
    throw fail(e.message, 2);
  }
  const { positionals, values } = parsed;
  if (positionals[0] !== 'build' || positionals.length !== 1) throw fail(`unknown stage ${positionals.join(' ') || '(none)'}; the only stage is build`, 2);
  if (!values.run || !values.out) throw fail('build needs --run and --out', 2);
  let maxUsd;
  if (values['max-usd'] !== undefined) {
    maxUsd = Number(values['max-usd']);
    if (values['max-usd'].trim() === '' || !Number.isFinite(maxUsd) || maxUsd < 0) throw fail(`--max-usd must be a number 0 or above, got ${values['max-usd']}`, 2);
  }
  return { runDir: values.run, ins: values.in ?? [], out: values.out, maxUsd };
}

// Inputs keyed by the contract each file declares, not by their order on the command line.
function loadInputs(paths) {
  const docs = {};
  for (const path of paths) {
    const doc = readContract(path);
    if (!NEEDS.includes(doc.contract)) throw fail(`${path}: build does not read ${doc.contract} files`, 2);
    if (docs[doc.contract]) throw fail(`${path}: a second ${doc.contract} file was given`, 2);
    docs[doc.contract] = doc;
  }
  const missing = NEEDS.filter((name) => !docs[name]);
  if (missing.length) throw fail(`missing --in for ${missing.join(', ')}`, 2);
  return docs;
}

const pagePath = (slug) => `c-build/site/dist/${slug === 'home' ? 'index' : slug}.html`;

// Budget stop: nothing is built, so the handoff says so and claims no QA result it did not measure.
function budgetHandoff({ run, inventory, storyboard }, cap) {
  const doc = {
    contract: 'handoff',
    version: '1.0.0',
    run_id: run.run_id,
    status: 'budget',
    site: {
      repo_path: 'c-build/site',
      preview_url: null,
      preview_local: 'c-build/site/dist',
      pages: storyboard.pages.map(({ slug }) => ({
        slug,
        path: pagePath(slug),
        screenshots: { desktop: `c-build/screens/${slug}-desktop.png`, mobile: `c-build/screens/${slug}-mobile.png` },
      })),
    },
    qa: {
      axe: { serious: 0, critical: 0, report_path: 'c-build/axe.json' },
      lighthouse: [],
      links: { checked: 0, broken: [] },
      fact_diff: { checked: 0, changed: [], missing: [] },
      gates_passed: false,
    },
    fidelity: { pages_carried: 0, pages_total: inventory.pages.length + inventory.failures.length, dropped: [], flagged: [] },
    report_path: 'c-build/report.md',
    cost_usd: 0,
  };
  const report = `# Build not run\n\nThe Lane C budget for this run is ${cap} USD, so the build stopped before doing any work. No site was built and no checks were run. Raise the budget and run the build again.\n`;
  return { doc, report };
}

function writeHandoff(out, runDir, { doc, report }) {
  const errors = schemaErrors(doc);
  if (errors.length) throw fail(`refusing to write an invalid handoff:\n  ${errors.join('\n  ')}`, 1);
  mkdirSync(join(runDir, 'c-build'), { recursive: true });
  writeFileSync(join(runDir, doc.report_path), report);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
}

async function main(argv) {
  const { runDir, ins, out, maxUsd } = parse(argv);
  const docs = loadInputs(ins);
  const cap = Math.min(maxUsd ?? Infinity, docs.run.limits.lane_budget_usd.c);
  if (cap <= 0) {
    writeHandoff(out, runDir, budgetHandoff(docs, cap));
    throw fail(`budget cap hit: Lane C has ${cap} USD for this run`, 4);
  }
  const { siteDir, pages } = await buildPages({ runDir, docs });
  const dist = join(siteDir, 'dist');
  const files = pages.map((p) => ({ slug: p.slug, file: basename(p.path) }));
  // Every gate runs, so one failed run reports everything that needs fixing.
  const a11y = await checkA11y({ dist, pages: files, reportPath: join(runDir, 'c-build', 'axe.json') });
  const links = await checkLinks({ dist, pages: files });
  const facts = factDiff({ dist, pages: files, inventory: docs.inventory, storyboard: docs.storyboard });
  const failures = [...a11y.failures, ...links.failures, ...facts.failures];

  // The handoff is written on a pass and on a fail, so the owner and the orchestrator always get one.
  const shots = await takeScreens({ dist, pages: files, runDir });
  const qa = {
    axe: { serious: a11y.axe.serious, critical: a11y.axe.critical, report_path: 'c-build/axe.json' },
    lighthouse: a11y.lighthouse,
    links: { checked: links.checked, broken: links.broken },
    fact_diff: { checked: facts.checked, changed: facts.changed, missing: facts.missing },
    gates_passed: failures.length === 0,
  };
  const carried = noDashesDeep(fidelity({ inventory: docs.inventory, storyboard: docs.storyboard, runDir }));
  const name = docs.storyboard.organisation.name;
  makeRepo({ siteDir, name, pages });
  const doc = {
    contract: 'handoff',
    version: '1.0.0',
    run_id: docs.run.run_id,
    status: qa.gates_passed ? 'pass' : 'fail',
    site: {
      repo_path: 'c-build/site',
      preview_url: null,
      preview_local: 'c-build/site/dist',
      pages: pages.map((p) => ({ slug: p.slug, path: p.path, screenshots: shots[p.slug] })),
    },
    qa,
    fidelity: carried,
    report_path: 'c-build/report.md',
    cost_usd: 0,
  };
  const report = noDashes(ownerReport({ name, pages, fidelity: carried, qa, failures }));
  writeHandoff(out, runDir, { doc, report });
  if (failures.length) throw fail(`quality gates failed (handoff written with status fail):\n  ${failures.join('\n  ')}`, 3);
  console.log(`handoff written: ${out} (status pass)`);
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  console.error(e.exitCode ? e.message : e.stack);
  process.exit(e.exitCode ?? 1);
}
