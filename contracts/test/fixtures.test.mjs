import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, crossErrors, schemaErrors } from '../validate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = join(root, 'fixtures/sample');

test('all seven sample fixtures exist and validate', () => {
  for (const file of Object.values(FILES)) {
    const data = JSON.parse(readFileSync(join(sample, file), 'utf8'));
    assert.deepEqual(schemaErrors(data), [], file);
  }
});

test('sample fixtures agree with each other: ids, references and paths', () => {
  assert.deepEqual(crossErrors(sample), []);
});

test('the cross check catches a storyboard block that is not in the inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contracts-'));
  cpSync(sample, dir, { recursive: true });
  const sb = JSON.parse(readFileSync(join(dir, FILES.storyboard), 'utf8'));
  sb.pages[0].sections[0].body_block_ids.push('p99-b999');
  writeFileSync(join(dir, FILES.storyboard), JSON.stringify(sb));
  assert.ok(crossErrors(dir).some((e) => e.includes('unknown block p99-b999')));
  rmSync(dir, { recursive: true });
});

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('no em or en dash in any contract text file', () => {
  const text = walk(root).filter((f) => !f.includes('node_modules') && /\.(json|md|mjs)$/.test(f));
  const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  for (const f of text) assert.ok(!dashes.some((d) => readFileSync(f, 'utf8').includes(d)), f);
});
