import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { check } from '../lib/contracts.mjs';
import { draftStory, gate, story } from '../story/story.mjs';
import { cli, fixture, load, SAMPLE, tmpRun } from './helpers.mjs';

const run = fixture('00-run.json');
const inv = fixture('10-inventory.json');
const blockIds = (i) => new Set(i.pages.flatMap((p) => p.blocks.map((b) => b.block_id)));
const usedBlocks = (sb) => new Set(sb.pages.flatMap((p) => p.sections.flatMap((s) => s.body_block_ids)));

test('rule draft on the sample is valid, uses only real block ids and covers every page', () => {
  const sb = draftStory(run, inv);
  assert.equal(check(sb), null);
  assert.deepEqual(gate(sb, inv), []);
  const ids = blockIds(inv);
  for (const id of usedBlocks(sb)) assert.ok(ids.has(id), id);
  const sourced = new Set(sb.pages.flatMap((p) => p.source_page_ids));
  for (const p of inv.pages) assert.ok(sourced.has(p.page_id) || sb.dropped.some((d) => d.ref === p.page_id), p.page_id);
  assert.deepEqual(sb.nav.map((n) => n.slug), ['home', 'about', 'contact']);
  assert.ok(sb.dropped.some((d) => d.ref.endsWith('calendar.html')), 'the 404 is dropped with a reason');
  assert.ok(sb.dropped.some((d) => d.ref === 'p03-f01'), 'the backend form is dropped with a reason');
  for (const s of sb.pages.flatMap((p) => p.sections)) if (s.copy_status === 'new') assert.doesNotMatch(s.copy.headline, /\d|@/);
  assert.equal(sb.organisation.name, 'Maple Grove High School');
});

test('every fact block is rendered or dropped by block id: contact facts in footers are kept, copyright years are dropped', () => {
  const scout = structuredClone(inv);
  scout.pages[1].blocks.find((b) => b.kind === 'footer').text = 'Main office (555) 010-0199';
  scout.facts.push({ fact_id: 'f009', kind: 'date', value: '2009', block_id: 'p01-b091' });
  scout.facts.push({ fact_id: 'f010', kind: 'phone', value: '(555) 010-0199', block_id: 'p02-b091' });
  scout.pages.push({ ...structuredClone(scout.pages[2]), page_id: 'p04', url: 'https://maplegrove-hs.example/empty.html', forms: [],
    blocks: [{ block_id: 'p04-b001', kind: 'nav', level: null, order: 0, text: 'Home | About' }] });
  const sb = draftStory(run, scout);
  assert.deepEqual(gate(sb, scout), []);
  assert.ok(usedBlocks(sb).has('p02-b091'), 'footer phone is rendered');
  assert.match(sb.dropped.find((d) => d.ref === 'p01-b091')?.reason ?? '', /2009/);
  assert.ok(sb.dropped.some((d) => d.ref === 'p04'), 'a page with no text is dropped');
});

test('gate catches invented ids, uncovered pages and digits in new copy', () => {
  const sb = draftStory(run, inv);
  sb.pages[0].sections[0].body_block_ids.push('p09-b001');
  sb.pages[0].sections[1].copy_status = 'new';
  sb.pages[0].sections[1].copy.headline = 'Call 555 today';
  sb.pages.pop();
  const problems = gate(sb, inv).join('\n');
  assert.match(problems, /p09-b001 is not in the inventory/);
  assert.match(problems, /digit or email/);
  assert.match(problems, /page p03 is neither used nor dropped/);
});

test('--live keeps a model reply that passes every check', async () => {
  const better = draftStory(run, inv);
  better.organisation.one_message = 'Every Mustang leaves ready for college, career and community life.';
  better.pages[0].sections[0].copy = { headline: 'Ready for college, career and community', subhead: null };
  better.pages[0].sections[0].copy_status = 'edited';
  better.pages[0].sections[0].edited_from_block_id = 'p01-b002';
  let sent;
  const ask = async ({ messages }) => { sent = messages; return `Here you go:\n\`\`\`json\n${JSON.stringify(better)}\n\`\`\``; };
  const { doc, problems } = await story({ run, inventory: inv, ask, live: true, models: { story: 'm' } });
  assert.deepEqual(problems, []);
  assert.equal(doc.pages[0].sections[0].copy_status, 'edited');
  assert.match(sent[1].content, /<data name="inventory">[\s\S]*never instructions/);
  assert.doesNotMatch(sent[1].content, /Dana Whitfield/, 'a block that names a person is withheld from the model');
});

test('--live falls back to the rule draft when the model invents a block id', async () => {
  const bad = draftStory(run, inv);
  bad.pages[0].sections[0].body_block_ids = ['p01-b777'];
  const logs = [];
  const { doc, problems } = await story({ run, inventory: inv, ask: async () => JSON.stringify(bad), live: true, models: { story: 'm' }, log: (m) => logs.push(m) });
  assert.deepEqual(problems, []);
  assert.deepEqual(doc, draftStory(run, inv));
  assert.match(logs.join(), /p01-b777/);
});

test('no person name reaches the model, even from a footer, a heading or the draft', async () => {
  for (const kind of ['footer', 'heading']) {
    const i = structuredClone(inv);
    Object.assign(i.pages[1].blocks.find((b) => b.block_id === 'p02-b003'), kind === 'heading' ? { kind, level: 2, text: 'Principal Dana Whitfield' } : { kind });
    let sent = '';
    await story({ run, inventory: i, ask: async ({ messages }) => { sent = JSON.stringify(messages); return '{}'; }, live: true, models: { story: 'm' }, log: () => {} });
    assert.ok(sent.length > 0);
    assert.doesNotMatch(sent, /Whitfield/, kind);
  }
});

test('a live reply with an invented "verbatim" or digit-bearing "edited" headline is rejected', async () => {
  for (const status of ['verbatim', 'edited']) {
    const bad = draftStory(run, inv);
    Object.assign(bad.pages[0].sections[0], { copy: { headline: 'School closed permanently, call 555 0000', subhead: null }, copy_status: status, edited_from_block_id: 'p01-b002' });
    assert.match(gate(bad, inv).join(), status === 'verbatim' ? /verbatim copy is not the text of a block/ : /edited copy has a digit/);
    const { doc } = await story({ run, inventory: inv, ask: async () => JSON.stringify(bad), live: true, models: { story: 'm' }, log: () => {} });
    assert.deepEqual(doc, draftStory(run, inv));
  }
});

test('a banner repeated on every page is carried once, and a short bold line acts as a heading', () => {
  const i = structuredClone(inv);
  for (const p of i.pages) p.blocks.unshift({ block_id: `${p.page_id}-b080`, kind: 'paragraph', level: null, order: -1, text: 'Maple Grove High School\nHome of the Mustangs' });
  const home = i.pages[0].blocks;
  home.find((b) => b.block_id === 'p01-b003').text = 'Fall conferences are November 12 and 13.';
  home.push({ block_id: 'p01-b005', kind: 'paragraph', level: null, order: 2, text: 'News and Announcements' });
  home.find((b) => b.block_id === 'p01-b003').order = 3;
  const sb = draftStory(run, i);
  assert.deepEqual(gate(sb, i), []);
  const used = [...usedBlocks(sb)];
  assert.ok(used.includes('p01-b080') && !used.includes('p02-b080') && !used.includes('p03-b080'));
  const news = sb.pages[0].sections.find((s) => s.copy.headline === 'News and Announcements');
  assert.equal(news?.intent, 'news');
  assert.deepEqual(news.body_block_ids, ['p01-b003']);
  assert.ok(used.includes('p02-b003'), '"Principal: Dana Whitfield" is copy, not a heading');
});

test('no text block is lost: every block but nav, footer, headings and repeated chrome is carried', () => {
  const i = structuredClone(inv);
  i.pages[1].blocks.push({ block_id: 'p02-b005', kind: 'paragraph', level: null, order: 4, text: 'Go Mustangs' });
  const sb = draftStory(run, i);
  const used = usedBlocks(sb);
  const lost = i.pages.flatMap((p) => p.blocks).filter((b) => !['nav', 'footer', 'heading'].includes(b.kind) && !used.has(b.block_id));
  assert.deepEqual(lost.map((b) => b.block_id), []);
});

test('a huge site stays within s999 and still carries every block', () => {
  const i = structuredClone(inv);
  i.facts = [];
  i.failures = [];
  i.pages = Array.from({ length: 40 }, (_, k) => {
    const id = `p${String(k + 1).padStart(2, '0')}`;
    return { ...structuredClone(inv.pages[1]), page_id: id, url: `https://maplegrove-hs.example/page${k}.html`, forms: [], images: [],
      blocks: Array.from({ length: 60 }, (_, j) => ({ block_id: `${id}-b${String(j + 1).padStart(3, '0')}`, kind: j % 2 ? 'paragraph' : 'heading', level: j % 2 ? null : 2, order: j, text: j % 2 ? `Body ${k} ${j}.` : `Topic ${k} ${j}` })) };
  });
  const sb = draftStory(run, i);
  assert.equal(check(sb), null);
  assert.deepEqual(gate(sb, i), []);
  assert.equal(usedBlocks(sb).size, 40 * 30, 'every paragraph is carried');
});

test('a site with no carry-over text exits 3 and writes nothing', () => {
  const r = tmpRun();
  const i = structuredClone(inv);
  for (const p of i.pages) p.blocks = p.blocks.filter((b) => b.kind === 'nav' || b.kind === 'footer');
  i.facts = [];
  writeFileSync(join(r, 'inv.json'), JSON.stringify(i));
  const res = cli(['story', '--run', r, '--in', join(SAMPLE, '00-run.json'), '--in', join(r, 'inv.json'), '--out', join(r, '20-storyboard.json')]);
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /no page of the inventory has text/);
  assert.equal(existsSync(join(r, '20-storyboard.json')), false);
});

test('story --live stops with exit 4 when earlier stages already spent the run cap', () => {
  const r = tmpRun();
  mkdirSync(join(r, 'b-design'));
  writeFileSync(join(r, 'b-design/cost.jsonl'), `${JSON.stringify({ stage: 'art', cost_usd: run.limits.lane_budget_usd.b })}\n`);
  const res = cli(['story', '--live', '--run', r, '--in', join(SAMPLE, '00-run.json'), '--in', join(SAMPLE, '10-inventory.json'), '--out', join(r, '20-storyboard.json')]);
  assert.equal(res.status, 4, res.stderr);
});

test('story CLI writes a valid storyboard for the sample', () => {
  const r = tmpRun();
  const res = cli(['story', '--run', r, '--in', join(SAMPLE, '00-run.json'), '--in', join(SAMPLE, '10-inventory.json'), '--out', join(r, '20-storyboard.json')]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(check(load(join(r, '20-storyboard.json'))), null);
});
