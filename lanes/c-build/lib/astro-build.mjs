// Builds a copy of the template with given tokens. The copy lives under .work/ so Astro and
// Tailwind resolve from lanes/c-build/node_modules; a folder under runs/ would find none.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LANE_DIR = join(import.meta.dirname, '..');
export const TEMPLATE_DIR = join(LANE_DIR, 'template');
export const WORK_ROOT = join(LANE_DIR, '.work');

const SKIP = new Set(['node_modules', '.astro', 'dist']);

// site, when given, replaces the template's src/data/site.json (pages, nav, copy).
export async function buildSite({ templateDir, tokens, site, workDir }) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  cpSync(templateDir, workDir, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
  writeFileSync(join(workDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');
  if (site) writeFileSync(join(workDir, 'src', 'data', 'site.json'), JSON.stringify(site, null, 2) + '\n');

  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  const { build } = await import('astro');
  await build({ root: workDir, logLevel: 'error' });
  return join(workDir, 'dist');
}
