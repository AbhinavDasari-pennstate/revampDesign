// The old site's own content for each section: its blocks (verbatim, tagged with their block id),
// its images and, for forms that posted to the old server, a phone and email fallback.
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fail } from '../lib/contracts.mjs';

export function indexInventory(inventory) {
  const blocks = new Map();
  const images = new Map();
  const forms = new Map();
  for (const page of inventory.pages) {
    for (const b of page.blocks) blocks.set(b.block_id, b);
    for (const i of page.images) images.set(i.image_id, i);
    forms.set(page.page_id, page.forms);
  }
  const fact = (kind) => inventory.facts.find((f) => f.kind === kind)?.value ?? null;
  return { blocks, images, forms, phone: fact('phone'), email: fact('email') };
}

// An edited section's headline is a rewrite of edited_from_block_id, so that block is not repeated below it.
export function sectionBlocks(section, index) {
  return section.body_block_ids
    .filter((id) => !(section.copy_status === 'edited' && id === section.edited_from_block_id))
    .map((id) => {
      const b = index.blocks.get(id);
      if (!b) throw fail(`20-storyboard.json: ${section.section_id} names block ${id}, which 10-inventory.json does not have`, 2);
      return { id, kind: b.kind, text: b.text };
    });
}

// Images Scout saved to disk; one with no local file cannot be carried over (the handoff report lists it, T23).
export function sectionImages(section, index, runDir) {
  return section.image_ids.flatMap((id) => {
    const image = index.images.get(id);
    if (!image) throw fail(`20-storyboard.json: ${section.section_id} names image ${id}, which 10-inventory.json does not have`, 2);
    if (!image.local_path || !existsSync(join(runDir, image.local_path))) return [];
    return [{ id, from: image.local_path, src: `./images/${id}${extname(image.local_path)}`, alt: image.alt, width: image.width, height: image.height }];
  });
}

// A static site cannot receive a form post, so each such form becomes a "call or email" note.
export function formFallbacks(page, index) {
  return page.source_page_ids
    .flatMap((id) => index.forms.get(id) ?? [])
    .filter((f) => f.needs_backend)
    .map((f) => ({ id: f.form_id, phone: index.phone, email: index.email }));
}
