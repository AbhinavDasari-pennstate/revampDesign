// Usage:
//   node orchestrator/cli.mjs run --stub --fixture <name or path> --out-dir <dir>
//   node orchestrator/cli.mjs run --url <site> --tier <A|B|C> [--out-dir <dir>] [--lanes-root <dir>] [--fixture <name or path>] [--pick d1|d2|d3] [--consent-note <text>] [--live]
// Stub mode (--stub, or no --url) copies a contract fixture into a new run folder. Real mode runs each lane CLI in order and
// falls back to the fixture for a lane whose CLI is missing. Defaults: --out-dir runs/, --lanes-root lanes/, --fixture sample.
// Exit 0 ok, 1 crash, 2 invalid input or contract file, 3 and 4 are passed through from the failing lane stage.
import { parseArgs } from 'node:util';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReal, runStub } from './lib/run.mjs';

const fixturesDir = fileURLToPath(new URL('../contracts/fixtures/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      stub: { type: 'boolean' }, fixture: { type: 'string' }, 'out-dir': { type: 'string' },
      url: { type: 'string' }, tier: { type: 'string' }, 'lanes-root': { type: 'string' }, pick: { type: 'string' },
      'consent-note': { type: 'string' }, live: { type: 'boolean' },
    },
  });
  const usage = (text) => Object.assign(new Error(`usage: ${text}`), { exitCode: 1 });
  const named = values.fixture ?? 'sample';
  const fixture = named === basename(named) ? join(fixturesDir, named) : resolve(named);
  let result;
  const outDir = resolve(values['out-dir'] ?? join(repoRoot, 'runs'));
  // `run --fixture <x>` without --url is the plan's stub form, so --stub is optional there.
  if (values.stub || values.url === undefined) {
    if (positionals[0] !== 'run') throw usage('node orchestrator/cli.mjs run [--stub] [--fixture <name or path>] [--out-dir <dir>]');
    for (const flag of ['url', 'tier', 'pick', 'consent-note', 'live']) {
      if (values[flag] !== undefined) throw Object.assign(new Error(`--${flag} is for real runs, not stub mode`), { exitCode: 2 });
    }
    result = runStub({ fixture, outDir });
  } else {
    if (positionals[0] !== 'run' || values.tier === undefined) {
      throw usage('node orchestrator/cli.mjs run --url <site> --tier <A|B|C> [--out-dir <dir>] [--lanes-root <dir>] [--fixture <name or path>] [--pick d1|d2|d3] [--consent-note <text>] [--live]');
    }
    result = runReal({
      url: values.url, tier: values.tier, fixture, pick: values.pick, consentNote: values['consent-note'], live: values.live, outDir,
      lanesRoot: resolve(values['lanes-root'] ?? join(repoRoot, 'lanes')),
    });
  }
  console.log(result.lines.join('\n'));
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 1);
}
