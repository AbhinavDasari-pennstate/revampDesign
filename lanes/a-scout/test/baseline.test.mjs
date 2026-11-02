import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, openRouterComplete, parseFiles, oneshot } from '../baseline/oneshot.mjs';

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
      'a-scout/baseline/screens/index-desktop.png',
      'a-scout/baseline/screens/index-mobile.png',
      'a-scout/baseline/site/about.html',
      'a-scout/baseline/site/index.html',
    ]);
    for (const name of ['index', 'about']) {
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
});
