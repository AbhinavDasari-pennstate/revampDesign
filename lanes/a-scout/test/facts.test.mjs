import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemaErrors } from '../../../contracts/validate.mjs';
import { chromium } from 'playwright';
import { readBrand } from '../scout/brand.mjs';
import { extractFacts } from '../scout/facts.mjs';
import { serve } from './serve.mjs';

const CLI = join(import.meta.dirname, '../cli.mjs');
const FIXTURES = join(import.meta.dirname, '../../../contracts/fixtures/sample');
const fixture = JSON.parse(readFileSync(join(FIXTURES, '10-inventory.json'), 'utf8'));
const fixtureRun = JSON.parse(readFileSync(join(FIXTURES, '00-run.json'), 'utf8'));

let site, out;
describe('scout facts and brand on the sample site', () => {
  before(async () => {
    site = await serve();
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    writeFileSync(join(dir, '00-run.json'), JSON.stringify({ ...fixtureRun, source_url: `${site.origin}/` }));
    await new Promise((resolve, reject) =>
      execFile(process.execPath, [CLI, 'scout', '--run', dir, '--in', join(dir, '00-run.json'), '--out', join(dir, '10-inventory.json')],
        (err) => (err ? reject(err) : resolve())));
    out = JSON.parse(readFileSync(join(dir, '10-inventory.json'), 'utf8'));
  });
  after(() => site.close());

  // f005 (person) is not extracted this week: no reliable rule.
  const expected = fixture.facts.filter((f) => f.kind !== 'person');
  const blocks = () => new Map(out.pages.flatMap((p) => p.blocks).map((b) => [b.block_id, b]));

  test('every fixture fact except person is found by kind and value', () => {
    for (const f of expected) {
      assert.ok(out.facts.some((a) => a.kind === f.kind && a.value === f.value), `${f.kind}: ${f.value}`);
    }
  });

  test('each fact points at a block that contains its value, or at a legal block', () => {
    for (const f of out.facts) {
      const block = blocks().get(f.block_id);
      assert.ok(block, f.block_id);
      if (f.kind === 'legal_notice') assert.equal(block.kind, 'legal');
      else if (f.kind === 'address') assert.ok(block.text.includes(f.value.split(', ')[0]), f.value);
      else assert.ok(block.text.includes(f.value), `${f.kind}: ${f.value}`);
    }
  });

  test('fact ids run f001 upward with no person, price or duplicate kind and value', () => {
    assert.deepEqual(out.facts.map((f) => f.fact_id), out.facts.map((_, i) => `f${String(i + 1).padStart(3, '0')}`));
    assert.ok(out.facts.every((f) => f.kind !== 'person' && f.kind !== 'price'));
    assert.equal(new Set(out.facts.map((f) => `${f.kind}|${f.value}`)).size, out.facts.length);
  });

  test('brand: background #fffff0, lowercase hex only, crest as logo, Times New Roman', () => {
    assert.ok(out.brand.colors.some((c) => c.hex === '#fffff0' && c.role === 'background'));
    assert.ok(out.brand.colors.some((c) => c.hex === '#003366' && c.role === 'primary'));
    assert.ok(out.brand.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
    assert.equal(out.brand.logo_path, 'a-scout/images/p01-i01.png');
    assert.ok(out.brand.fonts.some((f) => f.family === 'Times New Roman'));
  });

  test('the whole inventory is schema valid', () => {
    assert.deepEqual(schemaErrors(out), []);
  });
});

const block = (block_id, kind, text) => ({ block_id, kind, level: null, order: 0, text });

describe('extractFacts rules', () => {
  const facts = (...blocks) => extractFacts([{ blocks }]).map((f) => [f.kind, f.value, f.block_id]);

  test('a repeated value keeps its first block only; nav is not read', () => {
    assert.deepEqual(facts(
      block('p01-b001', 'nav', 'Call 555-010-0001'),
      block('p01-b002', 'paragraph', 'Call 555-010-0142'),
      block('p01-b003', 'contact', 'Phone 555-010-0142'),
    ), [['phone', '555-010-0142', 'p01-b002']]);
  });

  test('footer blocks are read, and a legal footer also gives its notice', () => {
    assert.deepEqual(facts(
      block('p01-b001', 'footer', '2200 Orchard Road\nMaple Grove, OH 45000\n(555) 010-0142'),
      block('p01-b002', 'footer', 'The district does not discriminate on the basis of sex.'),
    ), [['phone', '(555) 010-0142', 'p01-b001'], ['address', '2200 Orchard Road, Maple Grove, OH 45000', 'p01-b001'],
      ['legal_notice', 'Nondiscrimination notice', 'p01-b002']]);
  });

  test('digits that merely contain a phone shape are not a phone', () => {
    assert.deepEqual(facts(block('p01-b001', 'paragraph', 'Student ID 1234 567 8901')), []);
  });

  test('a street number is not read as a year, and a full date keeps its year', () => {
    assert.deepEqual(facts(
      block('p01-b001', 'contact', '2000 Main Street\nSpringfield, IL 62701'),
      block('p01-b002', 'paragraph', 'Closed on Dec. 24, 2026.'),
    ), [['address', '2000 Main Street, Springfield, IL 62701', 'p01-b001'], ['date', 'Dec. 24, 2026', 'p01-b002']]);
  });

  test('a bare four-digit number is a date only with date context', () => {
    assert.deepEqual(facts(
      block('p01-b001', 'paragraph', '2000 students and 1500 families joined us.'),
      block('p01-b002', 'paragraph', 'Founded in 1962, open since 1998.'),
    ), [['date', '1962', 'p01-b002'], ['date', '1998', 'p01-b002']]);
  });

  test('the email rule is linear: 50,000 characters with no @ finish in under 200 ms', () => {
    for (const text of ['a'.repeat(50000), 'a.b-c+d'.repeat(7200)]) {
      const start = performance.now();
      assert.deepEqual(facts(block('p01-b001', 'paragraph', text)), []);
      assert.ok(performance.now() - start < 200, `took ${Math.round(performance.now() - start)} ms`);
    }
    assert.deepEqual(facts(block('p01-b001', 'paragraph', 'Write to a.b+c@school.example.org today')), [['email', 'a.b+c@school.example.org', 'p01-b001']]);
  });

  test('legal notices are labelled by keyword', () => {
    assert.deepEqual(facts(
      block('p01-b001', 'legal', 'The district does not discriminate.'),
      block('p01-b002', 'legal', 'Our Title IX coordinator is available.'),
    ), [['legal_notice', 'Nondiscrimination notice', 'p01-b001'], ['legal_notice', 'Title IX notice', 'p01-b002']]);
  });
});

test('a page with no body does not lose the brand read', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><p>x</p></body></html>');
    await page.evaluate(() => document.body.remove());
    assert.deepEqual(await readBrand(page, []), { logo_path: null, colors: [], fonts: [] });
  } finally {
    await browser.close();
  }
});

describe('brand primary colour search', () => {
  const primary = async (html) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.setContent(`<html><body>${html}</body></html>`);
      return (await readBrand(page, [])).colors.find((c) => c.role === 'primary')?.hex;
    } finally {
      await browser.close();
    }
  };
  const band = '<div style="background:#7a0019;height:80px">School</div>';

  test('(a) a white wrapper over a transparent body is skipped for the band inside', async () => {
    assert.equal(await primary(`<div id="page" style="background:#fff">${band}</div>`), '#7a0019');
  });

  test('(b) a white header and a near-white body are skipped for the nav', async () => {
    assert.equal(await primary('<style>body{background:#f5f5f5}</style><header style="background:#fff">h</header><nav style="background:#003366">n</nav>'), '#003366');
  });

  test('(c) a display:none menu is skipped', async () => {
    assert.equal(await primary(`<div style="display:none;background:#222">menu</div>${band}`), '#7a0019');
  });

  test('(d) a fixed cookie bar is skipped', async () => {
    assert.equal(await primary(`<div style="position:fixed;top:0;left:0;right:0;background:#333">cookies</div>${band}`), '#7a0019');
  });

  test('(e) a computed oklch() header colour is read as hex; a transparent one stays transparent', async () => {
    const hex = await primary('<header style="background:oklch(0.4 0.15 250)">h</header>');
    assert.match(hex, /^#[0-9a-f]{6}$/);
    const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(b > r + 40, hex);
    assert.equal(await primary(`<header style="background:oklch(0.4 0.15 250 / 0)">h</header>${band}`), '#7a0019');
  });

  test('(f) color(srgb ...) and oklab() backgrounds are read too', async () => {
    assert.equal(await primary('<header style="background:color(srgb 0 0.2 0.4)">h</header>'), '#003366');
    assert.match(await primary('<header style="background:oklab(0.4 0.05 -0.1)">h</header>'), /^#[0-9a-f]{6}$/);
  });
});
