// The "plain Claude" competitor: ONE fixed prompt plus the inventory, one OpenRouter call, a static site, screenshots.
// The reply is untrusted model output. `complete(prompt)` is injectable so tests use a recorded reply.
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { DESKTOP, MOBILE } from '../scout/crawl.mjs';

const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });
const PROMPT = join(import.meta.dirname, 'prompt.md');
export const MODEL = JSON.parse(readFileSync(join(import.meta.dirname, '../models.json'), 'utf8')).baseline;
export const MAX_TOKENS = 32000;
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const TYPES = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const imagePath = (localPath) => (localPath ? `images/${basename(localPath)}` : null);
const screenName = (path) => path.replace(/\.html?$/i, '').replaceAll('/', '-');

export function buildPrompt(promptMd, inventory) {
  const site = {
    pages: inventory.pages.map((p) => ({
      url: p.url,
      title: p.title,
      blocks: p.blocks.map(({ kind, level, text }) => ({ kind, level, text })),
      links: p.links.map(({ href, text }) => ({ href, text })),
      images: p.images.map(({ image_id, alt, width, height, local_path }) => ({ image_id, alt, width, height, path: imagePath(local_path) })),
    })),
    brand: { logo: imagePath(inventory.brand.logo_path), colors: inventory.brand.colors, fonts: inventory.brand.fonts },
  };
  return `${promptMd}\n${JSON.stringify(site, null, 2)}\n`;
}

export async function openRouterComplete(key, model, prompt, fetchFn = fetch) {
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
  });
  if (res.status === 402 || res.status === 403) throw fail(`OpenRouter budget exhausted (HTTP ${res.status})`, 4);
  if (!res.ok) throw fail(`OpenRouter request failed (HTTP ${res.status})`, 1);
  const choice = (await res.json()).choices?.[0];
  if (choice?.finish_reason === 'length') throw fail(`the reply was cut off at ${MAX_TOKENS} tokens`, 3);
  if (typeof choice?.message?.content !== 'string' || !choice.message.content) throw fail('the reply has no content', 3);
  return choice.message.content;
}

const badPath = (path) => path.includes('\\') || path.includes(':')
  || path.split('/').some((seg) => seg.trim() === '' || seg === '.' || seg === '..' || seg === '~');

// "File: <path>" (optionally in backticks, asterisks or a # heading) then a fenced block.
// Any path that could leave site/ rejects the whole reply.
export function parseFiles(reply) {
  const found = [...reply.matchAll(/^[ \t]*(?:#+[ \t]*)?[`*]*[ \t]*File:[`*]*[ \t]*(.+?)[ \t]*\r?\n(?:[ \t]*\r?\n)*```[^\n]*\n([\s\S]*?)\n```/gm)];
  const files = found.map(([, path, content]) => ({ path: path.replace(/^[`*\s]+|[`*\s]+$/g, ''), content }));
  if (!files.some((f) => /\.html?$/i.test(f.path))) throw fail('the reply has no parseable html files', 3);
  for (const { path } of files) if (badPath(path)) throw fail(`the reply has an unsafe file path: ${path}`, 3);
  const names = files.filter((f) => /\.html?$/i.test(f.path)).map((f) => screenName(f.path));
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) throw fail(`two pages would share the screenshot name ${dupe}`, 3);
  return files;
}

// Serves only files inside root, on 127.0.0.1 and a random port.
export async function serveSite(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = resolve(base, rel);
      if (rel.includes('\\') || !file.startsWith(base + sep)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function screenshot(base, htmlPaths) {
  const site = await serveSite(join(base, 'site'));
  const browser = await chromium.launch();
  const blocked = [];
  const frames = [];
  const redirected = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    await context.route('**/*', (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith(`${site.origin}/`) || FONT_ORIGINS.some((o) => url.startsWith(`${o}/`))) return route.continue();
      blocked.push(url);
      if (request.redirectedFrom()) redirected.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    for (const path of htmlPaths) {
      await page.goto(`${site.origin}/${path}`, { waitUntil: 'networkidle' });
      frames.push(...page.frames().map((f) => f.url()));
      const name = screenName(path);
      await page.setViewportSize(DESKTOP);
      await page.screenshot({ path: join(base, 'screens', `${name}-desktop.png`), fullPage: true });
      await page.setViewportSize(MOBILE);
      await page.screenshot({ path: join(base, 'screens', `${name}-mobile.png`), fullPage: true });
    }
  } finally {
    await browser.close();
    await site.close();
  }
  if (redirected.length) throw fail(`the site redirected to a blocked origin: ${redirected[0]}`, 3);
  return { blocked, frames };
}

export async function oneshot({ inventory, runDir, complete }) {
  const files = parseFiles(await complete(buildPrompt(readFileSync(PROMPT, 'utf8'), inventory)));
  const base = join(runDir, 'a-scout', 'baseline');
  for (const { path, content } of files) {
    mkdirSync(dirname(join(base, 'site', path)), { recursive: true });
    writeFileSync(join(base, 'site', path), content);
  }
  if (existsSync(join(runDir, 'a-scout', 'images'))) cpSync(join(runDir, 'a-scout', 'images'), join(base, 'site', 'images'), { recursive: true });
  mkdirSync(join(base, 'screens'), { recursive: true });
  const htmlPaths = files.map((f) => f.path).filter((p) => /\.html?$/i.test(p));
  if (htmlPaths.length < inventory.pages.length) {
    console.error(`warning: the reply has ${htmlPaths.length} html file(s) for ${inventory.pages.length} pages`);
  }
  return { paths: files.map((f) => f.path), ...(await screenshot(base, htmlPaths)) };
}
