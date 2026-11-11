import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { boardHtml } from '../art/board.mjs';
import { draftDirections } from '../art/directions.mjs';
import { check } from '../lib/contracts.mjs';
import { draftStory } from '../story/story.mjs';
import { cli, fixture, load, SAMPLE, tmpRun } from './helpers.mjs';

const run = fixture('00-run.json');
const inv = fixture('10-inventory.json');

test('art CLI writes valid directions plus a desktop and mobile PNG per direction', () => {
  const r = tmpRun();
  writeFileSync(join(r, '20-storyboard.json'), JSON.stringify(draftStory(run, inv)));
  const res = cli(['art', '--run', r, '--in', join(SAMPLE, '00-run.json'), '--in', join(SAMPLE, '10-inventory.json'), '--in', join(r, '20-storyboard.json'), '--out', join(r, '30-directions.json')]);
  assert.equal(res.status, 0, res.stderr);
  const doc = load(join(r, '30-directions.json'));
  assert.equal(check(doc), null);
  for (const d of doc.directions) for (const kind of ['desktop', 'mobile']) {
    assert.equal(d.previews[kind], `b-design/previews/${d.direction_id}-${kind}.png`);
    const png = readFileSync(join(r, d.previews[kind]));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
  assert.ok(existsSync(join(r, 'b-design/boards/d1.html')));
});

test('boards draw no image from the old site (previews go to judges) and escape scraped text', () => {
  const sb = draftStory(run, inv);
  sb.pages[0].sections[0].copy.headline = '<script>alert(1)</script>';
  const html = boardHtml(draftDirections(run, inv, sb).directions[1], sb, { webFonts: false });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /a-scout\/images/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&#60;script&#62;/);
});

test('a heading that names a person is withheld on the boards the judges see; a broken cost log line is skipped', () => {
  const r = tmpRun();
  const i = structuredClone(inv);
  i.pages[0].blocks.push({ block_id: 'p01-b005', kind: 'heading', level: 2, order: 4, text: 'Meet Principal Dana Whitfield' },
    { block_id: 'p01-b006', kind: 'paragraph', level: null, order: 5, text: 'She joined last year.' });
  i.facts.push({ fact_id: 'f009', kind: 'person', value: 'Dana Whitfield', block_id: 'p01-b005' });
  writeFileSync(join(r, 'inv.json'), JSON.stringify(i));
  const sb = draftStory(run, i);
  assert.ok(sb.pages[0].sections.some((s) => s.copy.headline.includes('Whitfield')), 'the storyboard itself keeps the real headline');
  writeFileSync(join(r, '20-storyboard.json'), JSON.stringify(sb));
  mkdirSync(join(r, 'b-design'));
  writeFileSync(join(r, 'b-design/cost.jsonl'), '{bad\n');
  const res = cli(['art', '--run', r, '--in', join(SAMPLE, '00-run.json'), '--in', join(r, 'inv.json'), '--in', join(r, '20-storyboard.json'), '--out', join(r, '30-directions.json')]);
  assert.equal(res.status, 0, res.stderr);
  for (const id of ['d1', 'd2', 'd3']) assert.doesNotMatch(readFileSync(join(r, `b-design/boards/${id}.html`), 'utf8'), /Whitfield/);
});

test('without --live no image is generated: strategy is site photos or type only and generated is empty', () => {
  for (const d of draftDirections(run, inv, draftStory(run, inv)).directions) {
    assert.ok(['site_photos', 'type_only'].includes(d.imagery.strategy));
    assert.deepEqual(d.imagery.generated, []);
  }
});
