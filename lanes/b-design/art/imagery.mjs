// T18 part 2: Gemini imagery. Only when the old site has no usable photos does a direction get a generated hero
// image, and only d1 and d2 (d3 is type led by design), so a run costs at most two images.
// Prompts are text only: no image from the old site is ever sent to a model (plan T18).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE = ' No people, no faces, no lettering, no logos. Natural light, calm editorial photography.';
const SCENES = {
  d1: 'A quiet, orderly scene that suits a calm civic website',
  d2: 'A warm, proud scene that suits a confident website in the organisation\'s own colours',
};

export const hasSitePhotos = (inv) => inv.pages.some((p) => p.images.some((im) => im.origin !== 'third_party' && im.width >= 300));

// organisation is the scrubbed storyboard organisation, so no person name reaches the image model.
export function imagePrompt(d, organisation) {
  return `${SCENES[d.direction_id]} for ${organisation.name}: ${organisation.what_it_does}`.slice(0, 500) + SAFE;
}

// Mutates doc: sets imagery to { strategy: 'generated', generated: [{ path, prompt, model }] } and writes the file.
export async function addImagery(doc, { runDir, inventory, organisation, askImage, model }) {
  if (hasSitePhotos(inventory)) return;
  for (const d of doc.directions.filter((x) => SCENES[x.direction_id])) {
    const prompt = imagePrompt(d, organisation);
    const { bytes, ext } = await askImage({ model, prompt });
    const path = `b-design/images/${d.direction_id}-hero.${ext}`;
    mkdirSync(join(runDir, 'b-design', 'images'), { recursive: true });
    writeFileSync(join(runDir, path), bytes);
    d.imagery = { strategy: 'generated', generated: [{ path, prompt, model }] };
  }
}
