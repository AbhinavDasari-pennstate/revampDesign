// Reads the frozen web contract fixtures (contracts/web/fixtures/, tag contracts-web-v1.0.0) for the tests.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const fixturesDir = join(repoRoot, 'contracts', 'web', 'fixtures');

export const fixtureText = (name) => readFileSync(join(fixturesDir, name), 'utf8');
export const fixture = (name) => JSON.parse(fixtureText(name));

// Every error-<code>.json fixture as [code, body].
export const errorFixtures = () => readdirSync(fixturesDir)
  .filter((f) => /^error-[a-z_]+\.json$/.test(f))
  .map((f) => [f.slice('error-'.length, -'.json'.length), fixture(f)]);

// Every job-failed-<code>.json fixture as [file, body]. budget has two: one stopped mid run, one refused at the start.
export const failedJobFixtures = () => readdirSync(fixturesDir)
  .filter((f) => /^job-failed-[a-z_-]+\.json$/.test(f))
  .map((f) => [f, fixture(f)]);
