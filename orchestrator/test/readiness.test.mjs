// T24 integration readiness: every lane's stage command, run on main exactly as the orchestrator calls it,
// exits 0 against contracts/fixtures/sample/ and writes a valid contract file. Red until Lanes B and C land.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { FILES, schemaErrors } from '../../contracts/validate.mjs';
import { OWNERS, STAGES } from '../lib/run.mjs';
import { serve } from '../../lanes/a-scout/test/serve.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sample = join(root, 'contracts/fixtures/sample');
// Async on purpose: the scout stage crawls the local sample site served from this process.
const run = promisify(execFile);

const site = await serve();
after(() => site.close());

for (const [i, [stage, key, lane, inputs]] of STAGES.entries()) {
  if (!lane) continue;
  test(`${stage} (${lane}, ${OWNERS[lane]}) exits 0 on the sample fixture and writes a valid ${FILES[key]}`, async () => {
    const R = mkdtempSync(join(tmpdir(), `ready-${stage}-`));
    try {
      cpSync(sample, R, { recursive: true });
      // A stage must write its own output: drop it and every later stage's file before running.
      for (const [, later] of STAGES.slice(i)) rmSync(join(R, FILES[later]));
      const runFile = join(R, FILES.run);
      // The sample's source_url never resolves; point the scout at the same site served locally.
      writeFileSync(runFile, JSON.stringify({ ...JSON.parse(readFileSync(runFile, 'utf8')), source_url: `${site.origin}/` }));
      const ins = inputs.map((k) => join(R, FILES[k]));
      const out = join(R, FILES[key]);
      const args = [join(root, 'lanes', lane, 'cli.mjs'), stage, '--run', R, ...ins.flatMap((f) => ['--in', f]), '--out', out];
      const shown = `node lanes/${lane}/cli.mjs ${stage} --run R ${inputs.map((k) => `--in R/${FILES[k]}`).join(' ')} --out R/${FILES[key]}`;
      const where = `stage ${stage}, owner ${OWNERS[lane]} (${lane}), R = contracts/fixtures/sample/\n${shown}`;
      try {
        await run(process.execPath, args, { cwd: root, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
      } catch (e) {
        assert.fail(`${where}: exit ${e.code ?? e.signal}\n${e.stderr ?? e.message}`);
      }
      const doc = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(doc?.contract, key, `${where}: wrong contract in ${out}`);
      assert.deepEqual(schemaErrors(doc), [], `${where}: ${out} failed its schema`);
    } finally {
      rmSync(R, { recursive: true, force: true });
    }
  });
}
