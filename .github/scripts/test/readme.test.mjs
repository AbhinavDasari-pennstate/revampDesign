import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const pathLike = (t) => (t.includes('/') || /\.(mjs|json)$/.test(t)) && !t.includes('<') && !t.includes('://') && !t.startsWith('-') && !t.startsWith('runs/');

// { missing, lines }: paths named by commands in the fenced blocks of `text` that do not exist, and how many command lines
// were read. Only lines starting with node, npm, npx, cd, mkdir or cp (or a `( ... )` subshell of them) count. `a && b` is split. As in a shell, a bare `cd` moves every later line of its block,
// while a `cd` inside a subshell does not. Each block starts at the repo root.
function missingPaths(text) {
  const missing = [];
  let lines = 0;
  for (const [, body] of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    let cwd = root;
    for (const line of body.split('\n').map((l) => l.trim()).filter((l) => /^\(?\s*(node|npm|npx|cd|mkdir|cp)\b/.test(l))) {
      lines++;
      let here = cwd;
      for (const part of line.replace(/^\(|\)$/g, '').split('&&')) {
        const tokens = part.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
        if (tokens[0] === 'cd') {
          here = resolve(here, tokens[1]);
          if (!existsSync(here)) missing.push(`${line} -> ${tokens[1]}`);
          continue;
        }
        for (const t of tokens.filter(pathLike)) if (!existsSync(resolve(here, t))) missing.push(`${line} -> ${t}`);
      }
      if (!line.startsWith('(')) cwd = here;
    }
  }
  return { missing, lines };
}

const fence = (...lines) => `\`\`\`\n${lines.join('\n')}\n\`\`\``;

test('every path in a README command exists, and every line starts where the shell would be', () => {
  const { missing, lines } = missingPaths(readme);
  assert.ok(lines >= 5, 'the quick start should hold commands');
  assert.deepEqual(missing, []);
});

test('the checker follows the shell: a bare cd carries to later lines, a subshell does not, cp and mkdir are checked', () => {
  const bare = fence('cd contracts && npm ci', 'cd lanes/a-scout && npm ci');
  assert.deepEqual(missingPaths(bare).missing, ['cd lanes/a-scout && npm ci -> lanes/a-scout']);
  assert.deepEqual(missingPaths(fence('(cd contracts && npm ci)', '(cd lanes/a-scout && npm ci)')).missing, []);
  assert.deepEqual(missingPaths(fence('mkdir -p runs/x && cp contracts/fixtures/sample/00-run.json runs/x/00-run.json')).missing, []);
  assert.deepEqual(missingPaths(fence('mkdir -p runs/x && cp contracts/fixtures/sample/gone.json runs/x/00-run.json')).missing,
    ['mkdir -p runs/x && cp contracts/fixtures/sample/gone.json runs/x/00-run.json -> contracts/fixtures/sample/gone.json']);
});

test('README has no em or en dash', () => {
  assert.doesNotMatch(readme, /[\u2013\u2014]/);
});
