import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LANE = join(import.meta.dirname, '..');
export const SAMPLE = join(LANE, '../../contracts/fixtures/sample');
export const INVALID = join(LANE, '../../contracts/fixtures/invalid');
export const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const fixture = (name) => load(join(SAMPLE, name));
export const tmpRun = () => mkdtempSync(join(tmpdir(), 'lane-b-'));

// Runs the CLI with no web fonts (tests stay offline) and no key (no network).
export const cli = (args) => spawnSync(process.execPath, [join(LANE, 'cli.mjs'), ...args], {
  encoding: 'utf8', env: { ...process.env, B_NO_WEB_FONTS: '1', B_OPENROUTER_API_KEY: '' },
});
