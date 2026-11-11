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
    // Spaced and a.m./p.m. ranges, the way school sites write office hours (review of PR #29).
    [`8 a.m.${EN}4 p.m.`, '8 a.m. to 4 p.m.'],
    [`8:00 AM ${EN} 4:00 PM`, '8:00 AM to 4:00 PM'],
    [`Mon ${EN} Fri`, 'Mon to Fri'],
    [`Monday ${EN} Thursday, 7:30 am ${EN} 3 pm`, 'Monday to Thursday, 7:30 am to 3 pm'],
    [`September ${EN} June`, 'September to June'],
    [`Mon${EM}Fri`, 'Mon to Fri'],
    [`8 a.m. ${EN} noon`, '8 a.m. to noon'],
    [`Room 5 ${EN} Monday only`, 'Room 5, Monday only'],
    // Second review of PR #29: am/pm stuck to the digit, and a day or month before a time.
    [`Office hours 8:00am ${EN} 3:00pm`, 'Office hours 8:00am to 3:00pm'],
    [`8am${EM}3pm`, '8am to 3pm'],
    [`Join us Friday ${EM} 7 p.m. at the gym`, 'Join us Friday, 7 p.m. at the gym'],
    [`in March ${EM} 12 spots left`, 'in March, 12 spots left'],
    [`a ${EM} ${EM} b`, 'a, , b'],
    [`Name ${EN}  ${EN} Phone`, 'Name, , Phone'],
    // Still pauses: a dash that does not sit between two range ends.
    [`Open Monday ${EM} closed on holidays`, 'Open Monday, closed on holidays'],
    [`We march ${EN} proudly`, 'We march, proudly'],
  ];
  for (const [input, want] of cases) assert.equal(noDashes(input), want, JSON.stringify(input));
});

// A dash after a very long run of spaces must not take quadratic time (second review of PR #29).
test('the dash rule stays fast on long runs of spaces', () => {
  const text = `x${' '.repeat(50000)}x ${String.fromCharCode(0x2013)} y`;
  const start = performance.now();
  noDashes(text);
  assert.ok(performance.now() - start < 200, `took ${Math.round(performance.now() - start)} ms`);
});
