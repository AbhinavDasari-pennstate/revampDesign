// T06: the base template builds from a tokens.json and its output carries those tokens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, TEMPLATE_DIR, WORK_ROOT } from '../lib/astro-build.mjs';
import { nodeTooOld } from '../lib/node-version.mjs';

// Differs from template/tokens.json, so a pass cannot come from the template defaults.
const tokens = {
  color: { bg: '#fdfcf8', surface: '#eef3ea', text: '#1b2a1f', muted: '#4b5d50', accent: '#2e7d4f', on_accent: '#ffffff' },
  type: { display_family: 'Fraunces', body_family: 'Source Sans 3', source: 'google', scale_px: [17, 24, 34, 56], line_height: 1.6 },
  radius_px: 4,
  spacing_base_px: 8,
  motion: { level: 'subtle', reduced_motion_ok: true },
};

const workDir = join(WORK_ROOT, `test-template-${process.pid}`);
after(() => rmSync(workDir, { recursive: true, force: true }));

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

test('template builds with the given tokens and nothing banned', async () => {
  const dist = await buildSite({ templateDir: TEMPLATE_DIR, tokens, workDir });
  const files = filesUnder(dist);
  assert.ok(files.some((f) => f.endsWith('index.html')), 'dist/index.html exists');

  const text = files.filter((f) => /\.(html|css|js)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const css = files.filter((f) => /\.(html|css)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(css, /#2e7d4f/i, 'accent colour in the CSS');
  assert.match(css, /Source Sans 3/, 'body font family in the CSS');
  assert.match(css, /prefers-reduced-motion/, 'reduced motion handled in the CSS');

  // "three" alone is ordinary English ("three cards"), so only its module forms count as banned.
  for (const banned of [/gsap/i, /lenis/i, /three(\.module)?(\.min)?\.js/i, /from\s*["']three["']/i]) {
    assert.doesNotMatch(text, banned, `dist must not contain ${banned}`);
  }
});

// Issue #32 item 4: Astro writes its .astro folder in the working directory and imports from it, so a build
// started from a folder outside the lane could not find its own packages.
test('the template builds when the process runs from a folder outside the lane', async () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'c-build-cwd-'));
  const cwd = process.cwd();
  const dir = join(WORK_ROOT, `test-cwd-${process.pid}`);
  process.chdir(elsewhere);
  try {
    const dist = await buildSite({ templateDir: TEMPLATE_DIR, tokens, workDir: dir });
    assert.ok(existsSync(join(dist, 'index.html')));
    assert.equal(process.cwd(), elsewhere, 'the caller keeps its working directory');
    assert.deepEqual(readdirSync(elsewhere), [], 'nothing is written where the process was started');
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('the lane and the site it builds both declare the Node version Astro needs', () => {
  const lane = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const site = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'package.json'), 'utf8'));
  const astro = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'node_modules', 'astro', 'package.json'), 'utf8'));
  assert.equal(lane.engines?.node, astro.engines.node);
  assert.equal(site.engines?.node, astro.engines.node);
});

test('an old Node is named in a clear error', () => {
  assert.equal(nodeTooOld('22.21.9', '>=22.22.0'), 'Lane C needs Node 22.22.0 or newer (Astro); this is Node 22.21.9.');
  assert.equal(nodeTooOld('20.13.0', '>=22.22.0'), 'Lane C needs Node 22.22.0 or newer (Astro); this is Node 20.13.0.');
  assert.equal(nodeTooOld('22.22.0', '>=22.22.0'), null);
  assert.equal(nodeTooOld('24.11.0', '>=22.22.0'), null);
});
