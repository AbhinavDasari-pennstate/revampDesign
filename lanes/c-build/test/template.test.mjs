// T06: the base template builds from a tokens.json and its output carries those tokens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildSite, TEMPLATE_DIR, WORK_ROOT } from '../lib/astro-build.mjs';

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
