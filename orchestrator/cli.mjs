// Usage: node orchestrator/cli.mjs run [--stub] --fixture <name or path> --out-dir <dir>
// Stub mode copies a contract fixture into a new run folder. Exit 0 ok, 1 crash, 2 invalid contract file.
import { parseArgs } from 'node:util';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStub } from './lib/run.mjs';

const fixturesDir = fileURLToPath(new URL('../contracts/fixtures/', import.meta.url));

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { stub: { type: 'boolean' }, fixture: { type: 'string' }, 'out-dir': { type: 'string' } },
  });
  if (positionals[0] !== 'run' || !values.fixture || !values['out-dir']) {
    throw Object.assign(new Error('usage: node orchestrator/cli.mjs run [--stub] --fixture <name or path> --out-dir <dir>'), { exitCode: 1 });
  }
  const fixture = values.fixture === basename(values.fixture) ? join(fixturesDir, values.fixture) : resolve(values.fixture);
  const { lines } = runStub({ fixture, outDir: resolve(values['out-dir']) });
  console.log(lines.join('\n'));
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 1);
}
