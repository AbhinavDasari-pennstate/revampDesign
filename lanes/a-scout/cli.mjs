// Usage: node lanes/a-scout/cli.mjs scout --run <run dir> --in <00-run.json> --out <10-inventory.json>
// Exit 0 ok, 1 crash, 2 input failed its schema, 3 no page could be crawled (reason in a-scout/failure.json).
//        node lanes/a-scout/cli.mjs baseline --run <run dir> --in <10-inventory.json> [--response <recorded reply file>]
// baseline: exit 3 = reply had no parseable files or a path outside site/, 4 = OpenRouter budget (402 or 403).
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { schemaErrors } from '../../contracts/validate.mjs';
import { crawl } from './scout/crawl.mjs';
import { extractFacts } from './scout/facts.mjs';
import { MODEL, oneshot, openRouterComplete } from './baseline/oneshot.mjs';

const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { run: { type: 'string' }, in: { type: 'string' }, out: { type: 'string' }, response: { type: 'string' } },
  });
  if (positionals[0] === 'baseline') {
    if (!values.run || !values.in) throw fail('usage: node lanes/a-scout/cli.mjs baseline --run <run dir> --in <10-inventory.json> [--response <file>]', 1);
    const inventory = JSON.parse(readFileSync(resolve(values.in), 'utf8'));
    const errors = inventory.contract === 'inventory' ? schemaErrors(inventory) : ['not an inventory contract'];
    if (errors.length) throw fail(`input failed its schema: ${errors.join('; ')}`, 2);
    const key = process.env.A_OPENROUTER_API_KEY;
    if (!values.response && !key) throw fail('A_OPENROUTER_API_KEY is not set (Lane A key, see lanes/a-scout/.env.example)', 1);
    const complete = values.response ? async () => readFileSync(resolve(values.response), 'utf8') : (prompt) => openRouterComplete(key, MODEL, prompt);
    await oneshot({ inventory, runDir: resolve(values.run), complete });
    process.exit(0);
  }
  if (positionals[0] !== 'scout' || !values.run || !values.in || !values.out) {
    throw fail('usage: node lanes/a-scout/cli.mjs scout --run <run dir> --in <00-run.json> --out <10-inventory.json>', 1);
  }
  const runDir = resolve(values.run);
  const run = JSON.parse(readFileSync(resolve(values.in), 'utf8'));
  const inputErrors = run.contract === 'run' ? schemaErrors(run) : ['not a run contract'];
  if (inputErrors.length) throw fail(`input failed its schema: ${inputErrors.join('; ')}`, 2);

  const { pages, failures, brand } = await crawl({ startUrl: run.source_url, maxPages: run.limits.max_pages, runDir });
  if (!pages.length) {
    writeFileSync(join(runDir, 'a-scout', 'failure.json'), JSON.stringify({ reason: 'no page could be crawled', failures }, null, 2));
    throw fail('no page could be crawled, see a-scout/failure.json', 3);
  }
  const inventory = {
    contract: 'inventory',
    version: '1.0.0',
    run_id: run.run_id,
    crawled_at: new Date().toISOString(),
    robots_respected: true,
    pages,
    facts: extractFacts(pages),
    brand,
    failures,
    untrusted_text: true,
  };
  const outputErrors = schemaErrors(inventory);
  if (outputErrors.length) throw fail(`output failed its schema: ${outputErrors.join('; ')}`, 1);
  mkdirSync(join(resolve(values.out), '..'), { recursive: true });
  writeFileSync(resolve(values.out), JSON.stringify(inventory, null, 2));
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 1);
}
