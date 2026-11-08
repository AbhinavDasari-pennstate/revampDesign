// T18 part 2: Gemini imagery, with a fake image model (no network).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { boardHtml } from '../art/board.mjs';
import { draftDirections } from '../art/directions.mjs';
import { addImagery, hasSitePhotos } from '../art/imagery.mjs';
import { check } from '../lib/contracts.mjs';
import { askImage, BudgetError } from '../lib/openrouter.mjs';
import { draftStory, scrub } from '../story/story.mjs';
import { fixture, tmpRun } from './helpers.mjs';

const run = fixture('00-run.json');
const inv = fixture('10-inventory.json');
const sb = draftStory(run, inv);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fakeImages() {
  const calls = [];
  return { calls, askImage: async (args) => { calls.push(args); return { bytes: Buffer.from(PNG, 'base64'), ext: 'png' }; } };
}

test('with no usable site photos, d1 and d2 get one generated image each, recorded with prompt and model', async () => {
  assert.equal(hasSitePhotos(inv), false, 'the sample site has only a 64 px crest');
  const r = tmpRun();
  const doc = draftDirections(run, inv, sb);
  const fake = fakeImages();
  await addImagery(doc, { runDir: r, inventory: inv, organisation: scrub(sb.organisation, inv), askImage: fake.askImage, model: 'img-model' });
  assert.equal(fake.calls.length, 2);
  for (const id of ['d1', 'd2']) {
    const d = doc.directions.find((x) => x.direction_id === id);
    assert.equal(d.imagery.strategy, 'generated');
    const [g] = d.imagery.generated;
    assert.equal(g.path, `b-design/images/${id}-hero.png`);
    assert.equal(g.model, 'img-model');
    assert.match(g.prompt, /Maple Grove High School/);
    assert.match(g.prompt, /No people, no faces/);
    assert.ok(existsSync(join(r, g.path)));
  }
  assert.equal(doc.directions[2].imagery.strategy, 'type_only');
  assert.equal(check(doc), null);
});

test('only text goes to the image model, never an old site image', async () => {
  const fake = fakeImages();
  await addImagery(draftDirections(run, inv, sb), { runDir: tmpRun(), inventory: inv, organisation: scrub(sb.organisation, inv), askImage: fake.askImage, model: 'm' });
  for (const c of fake.calls) {
    assert.deepEqual(Object.keys(c).sort(), ['model', 'prompt']);
    assert.equal(typeof c.prompt, 'string');
    assert.doesNotMatch(c.prompt, /a-scout|base64|crest\.svg/);
  }
});

test('a site with usable photos generates nothing', async () => {
  const i = structuredClone(inv);
  i.pages[0].images[0].width = 800;
  const fake = fakeImages();
  await addImagery(draftDirections(run, i, sb), { runDir: tmpRun(), inventory: i, organisation: sb.organisation, askImage: fake.askImage, model: 'm' });
  assert.equal(fake.calls.length, 0);
});

test('the board draws the generated image and still no old site image', async () => {
  const doc = draftDirections(run, inv, sb);
  await addImagery(doc, { runDir: tmpRun(), inventory: inv, organisation: sb.organisation, askImage: fakeImages().askImage, model: 'm' });
  const html = boardHtml(doc.directions[0], sb, { webFonts: false });
  assert.match(html, /<img class="photo gen" src="\.\.\/images\/d1-hero\.png" alt="">/);
  assert.doesNotMatch(html, /a-scout/);
});

test('askImage sends a text prompt with image output, reads the data URL, and stops on 402', async () => {
  let sent;
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init) => { sent = JSON.parse(init.body); return reply(200, { choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${PNG}` } }] } }], usage: { cost: 0.04 } }); };
  const budget = { max: 1, spent: 0 };
  const img = await askImage({ model: 'g', prompt: 'a field', budget, fetch, key: 'k' });
  assert.deepEqual(sent.modalities, ['image', 'text']);
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'a field' }]);
  assert.equal(img.ext, 'jpg');
  assert.ok(img.bytes.length > 0);
  assert.equal(budget.spent, 0.04);
  await assert.rejects(askImage({ model: 'g', prompt: 'x', budget, fetch: async () => reply(402, {}), key: 'k' }), BudgetError);
  await assert.rejects(askImage({ model: 'g', prompt: 'x', budget, fetch: async () => reply(200, { choices: [{ message: { content: 'no image' } }] }), key: 'k' }), /no png, jpeg or webp image/);
});

test('models.json names an image model', () => {
  assert.match(JSON.parse(readFileSync(join(import.meta.dirname, '../models.json'), 'utf8')).image, /^google\//);
});
