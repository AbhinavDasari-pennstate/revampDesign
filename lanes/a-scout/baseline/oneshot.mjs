// The "plain Claude" competitor: ONE fixed prompt plus the inventory, one OpenRouter call, a static site, screenshots.
// The reply is untrusted model output. `complete(prompt)` is injectable so tests use a recorded reply.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { DESKTOP, MOBILE } from '../scout/crawl.mjs';

const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });
const PROMPT = join(import.meta.dirname, 'prompt.md');
export const MODEL = JSON.parse(readFileSync(join(import.meta.dirname, '../models.json'), 'utf8')).baseline;

export function buildPrompt(promptMd, inventory) {
  const site = {
    pages: inventory.pages.map((p) => ({
      url: p.url,
      title: p.title,
      blocks: p.blocks.map(({ kind, level, text }) => ({ kind, level, text })),
      links: p.links.map(({ href, text }) => ({ href, text })),
    })),
    brand: { colors: inventory.brand.colors, fonts: inventory.brand.fonts },
  };
  return `${promptMd}\n${JSON.stringify(site, null, 2)}\n`;
}

export async function openRouterComplete(key, model, prompt, fetchFn = fetch) {
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (res.status === 402 || res.status === 403) throw fail(`OpenRouter budget exhausted (HTTP ${res.status})`, 4);
  if (!res.ok) throw fail(`OpenRouter request failed (HTTP ${res.status})`, 1);
  return (await res.json()).choices[0].message.content;
}

// "File: <path>" then a fenced block. Any path that could leave site/ rejects the whole reply.
export function parseFiles(reply) {
  const files = [...reply.matchAll(/^File: *(.+?) *\r?\n```[^\n]*\n([\s\S]*?)\n```/gm)].map(([, path, content]) => ({ path, content }));
  if (!files.length) throw fail('the reply has no parseable files', 3);
  for (const { path } of files) {
    if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path) || path.split('/').includes('..')) {
      throw fail(`the reply has a file path outside site/: ${path}`, 3);
    }
  }
  return files;
}

export async function oneshot({ inventory, runDir, complete }) {
  const files = parseFiles(await complete(buildPrompt(readFileSync(PROMPT, 'utf8'), inventory)));
  const base = join(runDir, 'a-scout', 'baseline');
  for (const { path, content } of files) {
    mkdirSync(dirname(join(base, 'site', path)), { recursive: true });
    writeFileSync(join(base, 'site', path), content);
  }
  mkdirSync(join(base, 'screens'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const { path } of files.filter((f) => /\.html?$/i.test(f.path))) {
      await page.goto(pathToFileURL(join(base, 'site', path)).href);
      const name = path.replace(/\.html?$/i, '').replaceAll('/', '-');
      await page.setViewportSize(DESKTOP);
      await page.screenshot({ path: join(base, 'screens', `${name}-desktop.png`), fullPage: true });
      await page.setViewportSize(MOBILE);
      await page.screenshot({ path: join(base, 'screens', `${name}-mobile.png`), fullPage: true });
    }
  } finally {
    await browser.close();
  }
  return files.map((f) => f.path);
}
