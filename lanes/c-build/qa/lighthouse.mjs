// Lighthouse on each page with its default mobile settings, in Playwright's Chromium so CI and laptops
// test the same browser. Reduced motion is forced so nothing is measured mid-animation.
import lighthouse from 'lighthouse';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const CATEGORIES = ['accessibility', 'performance', 'best-practices'];

function freePort() {
  return new Promise((done, failed) => {
    const s = createServer();
    s.once('error', failed);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

export async function runLighthouse({ origin, pages }) {
  const port = await freePort();
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`, '--force-prefers-reduced-motion'] });
  try {
    const results = [];
    for (const { slug, file } of pages) {
      const { lhr } = await lighthouse(`${origin}/${file}`, { port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES });
      if (lhr.runtimeError) throw new Error(`Lighthouse failed on ${file}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
      const score = (id) => Math.round((lhr.categories[id].score ?? 0) * 100);
      results.push({
        slug,
        form_factor: lhr.configSettings.formFactor,
        accessibility: score('accessibility'),
        performance: score('performance'),
        best_practices: score('best-practices'),
      });
    }
    return results;
  } finally {
    await browser.close();
  }
}
