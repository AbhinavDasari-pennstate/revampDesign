// T15: the old site's own words, images and forms go into the built pages, each tagged with its source id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPages } from '../builder/pages.mjs';
import { noDashes } from '../builder/text.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'contracts', 'fixtures', 'sample');
const FILES = { run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json', selection: '45-selection.json' };
const EM = String.fromCharCode(0x2014);

let runDir;
let docs;

// The sample plus two hostile edits: a dash in a verbatim block, and markup in a scraped block.
before(async () => {
  runDir = mkdtempSync(join(tmpdir(), 'c-build-content-'));
  for (const f of Object.values(FILES)) cpSync(join(SAMPLE, f), join(runDir, f));
  cpSync(join(SAMPLE, 'a-scout'), join(runDir, 'a-scout'), { recursive: true });
  docs = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(readFileSync(join(runDir, f), 'utf8'))]));
  const block = (id) => docs.inventory.pages.flatMap((p) => p.blocks).find((b) => b.block_id === id);
  block('p02-b003').text = `Principal ${EM} Dana Whitfield`;
  block('p02-b004').text += ' <script>alert(1)</script>';
  await buildPages({ runDir, docs });
});
after(() => rmSync(runDir, { recursive: true, force: true }));

const html = (file) => readFileSync(join(runDir, 'c-build', 'site', 'dist', file), 'utf8');
const pageFile = (slug) => (slug === 'home' ? 'index.html' : `${slug}.html`);
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m]);

// Text of the element carrying data-src="<id>", tags turned into spaces.
function renderedText(page, id) {
  const m = page.match(new RegExp(`<(\\w+)[^>]*data-src="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
  return m && squash(decode(m[2].replace(/<[^>]+>/g, ' ')));
}

// Blocks a section renders: all its body blocks, except the one an edited section rewrote into its headline.
const rendered = (s) => s.body_block_ids.filter((id) => !(s.copy_status === 'edited' && id === s.edited_from_block_id));

test('every rendered block carries data-src with its block id', () => {
  for (const page of docs.storyboard.pages) {
    const out = html(pageFile(page.slug));
    for (const s of page.sections) for (const id of rendered(s)) assert.match(out, new RegExp(`data-src="${id}"`), `${page.slug} ${id}`);
  }
});

test('verbatim blocks match the inventory text after whitespace and the dash rule', () => {
  const inv = new Map(docs.inventory.pages.flatMap((p) => p.blocks).map((b) => [b.block_id, b.text]));
  for (const page of docs.storyboard.pages) {
    const out = html(pageFile(page.slug));
    for (const s of page.sections.filter((x) => x.copy_status === 'verbatim')) {
      for (const id of rendered(s)) assert.equal(renderedText(out, id), squash(noDashes(inv.get(id))), id);
    }
  }
  assert.equal(renderedText(html('about.html'), 'p02-b003'), 'Principal, Dana Whitfield');
});

test('an edited section does not repeat the block its headline was rewritten from', () => {
  assert.doesNotMatch(html('index.html'), /data-src="p01-b002"/);
});

test('scraped text is escaped, never markup', () => {
  const out = html('about.html');
  assert.doesNotMatch(out, /<script>alert/);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('section images are copied into the site and rendered with their alt text', () => {
  assert.ok(existsSync(join(runDir, 'c-build', 'site', 'dist', 'images', 'p01-i01.png')));
  assert.match(html('index.html'), /<img[^>]*src="\.\/images\/p01-i01\.png"[^>]*alt="Maple Grove High School crest"|<img[^>]*alt="Maple Grove High School crest"[^>]*src="\.\/images\/p01-i01\.png"/);
});

test('a form that needs a backend renders the fallback with the phone and email, not a form', () => {
  const out = html('contact.html');
  const fallback = out.match(/<(\w+)[^>]*data-src="p03-f01"[^>]*>[\s\S]*?<\/\1>/)?.[0] ?? '';
  assert.match(fallback, /data-fallback="form"/);
  assert.match(fallback, /href="tel:5550100142"/);
  assert.match(fallback, /\(555\) 010-0142/);
  assert.match(fallback, /href="mailto:office@maplegrove-hs\.example"/);
  assert.doesNotMatch(out, /<form/);
});

// Issue #15: the dash rule must keep ranges as ranges. Built from char codes so this file has no dashes.
test('the dash rule keeps ranges and grade spans, and only turns pauses into commas', () => {
  const EN = String.fromCharCode(0x2013);
  const cases = [
    [`Grades K${EN}8`, 'Grades K-8'],
    [`Pre-K${EN}5`, 'Pre-K-5'],
    [`Open Mon${EN}Fri`, 'Open Mon to Fri'],
    [`7:30 AM${EN}3:30 PM`, '7:30 AM to 3:30 PM'],
    [`Grades 9${EN}12`, 'Grades 9-12'],
    [`1990${EN}2000`, '1990-2000'],
    [`Grades 9${EN}12 ${EM} about 640 students`, 'Grades 9-12, about 640 students'],
    [`Since 1962${EM}and counting`, 'Since 1962, and counting'],
    [`Principal ${EM} Dana Whitfield`, 'Principal, Dana Whitfield'],
  ];
  for (const [input, want] of cases) assert.equal(noDashes(input), want, JSON.stringify(input));
});
