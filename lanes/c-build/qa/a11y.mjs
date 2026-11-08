// Accessibility gates: axe-core (WCAG 2.0 and 2.1, A and AA) at desktop and mobile widths, plus
// Lighthouse mobile accessibility. The build passes only with zero serious, zero critical and a
// Lighthouse accessibility score of at least 95 on every page.
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { runLighthouse } from './lighthouse.mjs';
import { serve } from './serve.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
export const MIN_ACCESSIBILITY = 95;

// Runs axe on every page at both widths and writes the findings to reportPath.
export async function runAxe({ origin, pages, reportPath }) {
  const report = { tags: TAGS, pages: [] };
  const browser = await chromium.launch();
  try {
    for (const [form_factor, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      for (const { slug, file } of pages) {
        const page = await context.newPage();
        await page.goto(`${origin}/${file}`, { waitUntil: 'load' });
        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        report.pages.push({
          slug,
          form_factor,
          violations: violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, help_url: v.helpUrl, targets: v.nodes.map((n) => n.target.join(' ')) })),
        });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const all = report.pages.flatMap((p) => p.violations.map((v) => ({ ...v, slug: p.slug, form_factor: p.form_factor })));
  return {
    serious: all.filter((v) => v.impact === 'serious').length,
    critical: all.filter((v) => v.impact === 'critical').length,
    blocking: all.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  };
}

// Serves dist, runs both tools, and says in plain words what failed.
export async function checkA11y({ dist, pages, reportPath }) {
  const server = await serve(dist);
  try {
    const { serious, critical, blocking } = await runAxe({ origin: server.origin, pages, reportPath });
    const lighthouse = await runLighthouse({ origin: server.origin, pages });
    const failures = [
      ...[...new Set(blocking.map((v) => `axe ${v.impact} ${v.id} on ${v.slug}: ${v.help}`))],
      ...lighthouse.filter((l) => l.accessibility < MIN_ACCESSIBILITY).map((l) => `Lighthouse ${l.form_factor} accessibility ${l.accessibility} on ${l.slug} (needs ${MIN_ACCESSIBILITY})`),
    ];
    return { axe: { serious, critical }, lighthouse, gates_passed: failures.length === 0, failures };
  } finally {
    await server.close();
  }
}
