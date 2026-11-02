import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_TOKENS, buildPrompt, openRouterComplete, parseFiles, oneshot, serveSite } from '../baseline/oneshot.mjs';

const ROOT = join(import.meta.dirname, '..');
const INVENTORY = join(ROOT, '../../contracts/fixtures/sample/10-inventory.json');
const REPLY = join(import.meta.dirname, 'baseline-reply.txt');
const PROMPT = readFileSync(join(ROOT, 'baseline/prompt.md'), 'utf8');
const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'));

const newRun = () => {
  const run = mkdtempSync(join(tmpdir(), 'baseline-'));
  cpSync(INVENTORY, join(run, '10-inventory.json'));
  return run;
};
const tree = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? tree(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).replaceAll('\\', '/')]);
const cli = (args, env = {}) => spawnSync(process.execPath, [join(ROOT, 'cli.mjs'), 'baseline', ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
});
const pngWidth = (file) => readFileSync(file).readUInt32BE(16);

describe('baseline one-shot', () => {
  test('a recorded reply becomes a site, screenshotted at both Scout widths', () => {
    const run = newRun();
    const r = cli(['--run', run, '--in', join(run, '10-inventory.json'), '--response', REPLY]);
    assert.equal(r.status, 0, r.stderr);
    const files = tree(run).filter((f) => f !== '10-inventory.json');
    assert.deepEqual(files.sort(), [
      'a-scout/baseline/screens/about-desktop.png',
      'a-scout/baseline/screens/about-mobile.png',
      'a-scout/baseline/screens/contact-desktop.png',
      'a-scout/baseline/screens/contact-mobile.png',
      'a-scout/baseline/screens/index-desktop.png',
      'a-scout/baseline/screens/index-mobile.png',
      'a-scout/baseline/site/about.html',
      'a-scout/baseline/site/contact.html',
      'a-scout/baseline/site/index.html',
    ]);
    for (const name of ['index', 'about', 'contact']) {
      assert.equal(pngWidth(join(run, `a-scout/baseline/screens/${name}-desktop.png`)), 1440);
      assert.equal(pngWidth(join(run, `a-scout/baseline/screens/${name}-mobile.png`)), 390);
    }
    assert.match(readFileSync(join(run, 'a-scout/baseline/site/index.html'), 'utf8'), /Welcome to Maple Grove/);
  });

  test('the prompt is prompt.md plus the inventory content, one shot, identical on two runs', async () => {
    const prompts = [];
    for (let i = 0; i < 2; i++) {
      await oneshot({ inventory, runDir: newRun(), complete: async (p) => (prompts.push(p), readFileSync(REPLY, 'utf8')) });
    }
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0], prompts[1]);
    assert.equal(prompts[0], buildPrompt(PROMPT, inventory));
    assert.ok(prompts[0].startsWith(PROMPT));
    for (const text of ['Welcome to Maple Grove High School', 'About Us - Maple Grove High School', '/calendar.html', '#003366', '(555) 010-0142']) {
      assert.ok(prompts[0].includes(text), text);
    }
  });

  test('the prompt stays plain: no design guidance of ours', () => {
    assert.doesNotMatch(PROMPT, /storyboard|direction|banned|award|oklch|WCAG|axe/i);
  });

  test('a reply whose paths escape site/ is rejected', () => {
    for (const bad of ['../evil.html', '/abs.html', 'a\\b.html', 'ok/../../x.html']) {
      assert.throws(() => parseFiles(`File: ${bad}\n\`\`\`html\n<p>x</p>\n\`\`\``), (e) => e.exitCode === 3, bad);
    }
  });

  test('a reply with no files exits 3 and writes no site', () => {
    const run = newRun();
    const noFiles = join(run, 'reply.txt');
    writeFileSync(noFiles, 'Sorry, I cannot do that.');
    const r = cli(['--run', run, '--in', join(run, '10-inventory.json'), '--response', noFiles]);
    assert.equal(r.status, 3);
    assert.equal(existsSync(join(run, 'a-scout/baseline/site')), false);
  });

  test('a path-escape reply exits 3 through the CLI and writes nothing outside', () => {
    const run = newRun();
    const evil = join(run, 'reply.txt');
    writeFileSync(evil, 'File: ../../escaped.html\n```html\n<p>x</p>\n```');
    const r = cli(['--run', run, '--in', join(run, '10-inventory.json'), '--response', evil]);
    assert.equal(r.status, 3);
    assert.equal(existsSync(join(run, '../escaped.html')), false);
  });

  test('402 and 403 from OpenRouter exit 4; the key is never in the error', async () => {
    for (const status of [402, 403]) {
      const fetchFn = async () => ({ ok: false, status, text: async () => 'out of credit' });
      await assert.rejects(openRouterComplete('sk-secret-123', 'm', 'p', fetchFn), (e) => e.exitCode === 4 && !e.message.includes('sk-secret-123'));
    }
  });

  test('openRouterComplete sends one request with the model and returns the reply text', async () => {
    const calls = [];
    const fetchFn = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });
    assert.equal(await openRouterComplete('k', 'anthropic/claude-opus-4.5', 'prompt text', fetchFn), 'hi');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'anthropic/claude-opus-4.5');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'prompt text' }]);
  });

  test('a missing key exits 1 with a clear message and makes no call', () => {
    const run = newRun();
    const r = cli(['--run', run, '--in', join(run, '10-inventory.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /A_OPENROUTER_API_KEY/);
  });

  test('item 1: untrusted HTML cannot read local files or reach other origins', async () => {
    const run = newRun();
    const marker = join(run, 'marker.txt');
    writeFileSync(marker, 'SECRET-MARKER');
    const hits = [];
    const other = createServer((req, res) => (hits.push(req.url), res.end('x')));
    await new Promise((r) => other.listen(0, '127.0.0.1', r));
    const off = `http://127.0.0.1:${other.address().port}`;
    const fileUrl = pathToFileURL(marker).href;
    const html = `<!doctype html><title>t</title><iframe src="${fileUrl}"></iframe><img src="${off}/pixel.png">`
      + `<script>fetch("${off}/fetch");setTimeout(()=>{location.href="${fileUrl}"},0)</script>`;
    try {
      const out = await oneshot({ inventory, runDir: run, complete: async () => `File: index.html\n\`\`\`html\n${html}\n\`\`\`` });
      assert.deepEqual(hits, []);
      assert.ok(out.blocked.some((u) => u.startsWith(`${off}/pixel.png`)), out.blocked.join());
      assert.ok(out.blocked.some((u) => u.startsWith(`${off}/fetch`)));
      assert.ok(out.frames.every((u) => !u.startsWith('file:')), out.frames.join());
      assert.ok(out.frames[0].startsWith('http://127.0.0.1:'));
    } finally {
      other.close();
    }
  });

  test('item 1: the site server serves only files inside site/', async () => {
    const run = newRun();
    mkdirSync(join(run, 'site'));
    writeFileSync(join(run, 'site/ok.html'), 'ok');
    const srv = await serveSite(join(run, 'site'));
    const raw = (path) => new Promise((resolve) => {
      const u = new URL(srv.origin);
      request({ host: u.hostname, port: u.port, path }, (res) => (res.resume(), resolve(res.statusCode))).end();
    });
    try {
      assert.equal(await raw('/ok.html'), 200);
      assert.equal(await raw('/%2e%2e/10-inventory.json'), 404);
      assert.equal(await raw('/..%2f10-inventory.json'), 404);
      assert.equal(await raw('/%2e%2e%5c10-inventory.json'), 404);
    } finally {
      await srv.close();
    }
  });

  test('item 2: images and logo go into the prompt and the run images are copied into site/images', async () => {
    const run = newRun();
    mkdirSync(join(run, 'a-scout/images'), { recursive: true });
    writeFileSync(join(run, 'a-scout/images/p01-i01.png'), 'png');
    let prompt;
    await oneshot({ inventory, runDir: run, complete: async (p) => ((prompt = p), readFileSync(REPLY, 'utf8')) });
    assert.ok(prompt.includes('images/p01-i01.png'));
    assert.ok(!prompt.includes('a-scout/images'));
    assert.ok(prompt.includes('Maple Grove High School crest'));
    assert.equal(readFileSync(join(run, 'a-scout/baseline/site/images/p01-i01.png'), 'utf8'), 'png');
    assert.doesNotMatch(PROMPT, /no web fonts|no remote images/i);
  });

  test('item 3: length cut-off exits 3, max_tokens is set, no html exits 3, fewer pages warns', async () => {
    const cut = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'File: a.html' } }] }) });
    await assert.rejects(openRouterComplete('k', 'm', 'p', cut), (e) => e.exitCode === 3);
    let body;
    await openRouterComplete('k', 'm', 'p', async (u, init) => ((body = JSON.parse(init.body)), { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }) }));
    assert.equal(body.max_tokens, MAX_TOKENS);
    assert.throws(() => parseFiles('File: style.css\n```css\nbody{}\n```'), (e) => e.exitCode === 3);
    const warn = mock.method(console, 'error', () => {});
    try {
      await oneshot({ inventory, runDir: newRun(), complete: async () => 'File: index.html\n```html\n<p>x</p>\n```' });
      assert.match(warn.mock.calls.map((c) => c.arguments[0]).join('\n'), /1 html file.*3 pages/);
      warn.mock.resetCalls();
      await oneshot({ inventory, runDir: newRun(), complete: async () => readFileSync(REPLY, 'utf8') });
      assert.equal(warn.mock.calls.length, 0);
    } finally {
      warn.mock.restore();
    }
  });

  test('item 4: File lines may be wrapped in backticks, asterisks or a # prefix, with blank lines before the fence', () => {
    const forms = ['File: a.html', '`File: a.html`', '**File: a.html**', '**File:** a.html', 'File: `a.html`', '### File: a.html', '## **File: a.html**'];
    for (const line of forms) {
      for (const gap of ['\n', '\n\n', '\n \n\n']) {
        assert.deepEqual(parseFiles(`${line}${gap}\`\`\`html\n<p>x</p>\n\`\`\``), [{ path: 'a.html', content: '<p>x</p>' }], JSON.stringify(line + gap));
      }
    }
  });

  test('item 5: a 200 with no choices or null content exits 3', async () => {
    for (const json of [{}, { choices: [] }, { choices: [{ message: { content: null } }] }]) {
      await assert.rejects(openRouterComplete('k', 'm', 'p', async () => ({ ok: true, status: 200, json: async () => json })), (e) => e.exitCode === 3);
    }
  });

  test('item 6: empty, dot, tilde, colon and blank path names are rejected', () => {
    for (const bad of ['a//b.html', './a.html', '~/a.html', 'dir/~/a.html', 'C:a.html', 'a:b.html', 'dir/ /a.html', 'dir/']) {
      assert.throws(() => parseFiles(`File: ${bad}\n\`\`\`html\n<p>x</p>\n\`\`\``), (e) => e.exitCode === 3, bad);
    }
  });

  test('item 7: two pages that would share a screenshot name exit 3', () => {
    const reply = 'File: a-b.html\n```html\n1\n```\nFile: a/b.html\n```html\n2\n```';
    assert.throws(() => parseFiles(reply), (e) => e.exitCode === 3);
  });
});
