// Full-page screenshots of every built page at desktop and phone widths, for the owner and the
// blind test. Reduced motion is on, so nothing is captured halfway through the fade-in.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../qa/serve.mjs';

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

// Returns { slug: { desktop, mobile } } with paths relative to the run folder.
export async function takeScreens({ dist, pages, runDir }) {
  mkdirSync(join(runDir, 'c-build', 'screens'), { recursive: true });
  const server = await serve(dist);
  const browser = await chromium.launch();
  const shots = Object.fromEntries(pages.map((p) => [p.slug, {}]));
  try {
    for (const [form, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      for (const { slug, file } of pages) {
        const page = await context.newPage();
        await page.goto(`${server.origin}/${file}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const rel = `c-build/screens/${slug}-${form}.png`;
        await page.screenshot({ path: join(runDir, rel), fullPage: true });
        shots[slug][form] = rel;
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return shots;
}
