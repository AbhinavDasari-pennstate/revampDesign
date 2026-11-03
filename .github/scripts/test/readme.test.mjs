import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

// Every line in a fenced block that starts with node, npm, cd or npx. `a && b` is split, and `cd x` moves later parts into x.
function commands() {
  const lines = [...readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n'));
  return lines.map((l) => l.trim()).filter((l) => /^(node|npm|cd|npx)\b/.test(l));
}

const pathLike = (t) => (t.includes('/') || /\.(mjs|json)$/.test(t)) && !t.includes('<') && !t.includes('://') && !t.startsWith('-') && !t.startsWith('runs/');

test('every path in a README command exists', () => {
  const cmds = commands();
  assert.ok(cmds.length >= 5, 'the quick start should hold commands');
  const missing = [];
  for (const line of cmds) {
    let cwd = root;
    for (const part of line.split('&&')) {
      const tokens = part.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
      if (tokens[0] === 'cd') {
        cwd = resolve(cwd, tokens[1]);
        if (!existsSync(cwd)) missing.push(`${line} -> ${tokens[1]}`);
        continue;
      }
      for (const t of tokens.filter(pathLike)) {
        if (!existsSync(resolve(cwd, t))) missing.push(`${line} -> ${t}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('README has no em or en dash', () => {
  assert.doesNotMatch(readme, /[\u2013\u2014]/);
});
