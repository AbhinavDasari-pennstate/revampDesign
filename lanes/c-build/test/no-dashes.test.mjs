// House rule: no em or en dashes in Lane C's own files (code, tests, docs, template).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const LANE = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.work', '.astro', 'dist']);
const DASH = /[\u2013\u2014]/;

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name))
    .flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

test('no em or en dash in any Lane C file', () => {
  const bad = filesUnder(LANE).filter((f) => DASH.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => relative(LANE, f)), []);
});
