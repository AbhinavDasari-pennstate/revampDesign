// What the new site carries over from the old one. Everything left out is listed as dropped with a
// reason; anything carried in a changed form that the owner should know about is flagged.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const FORM_FALLBACK_REASON =
  'This online form sent messages to the old web server, which the new site does not have. Visitors are asked to call or email instead. Set up a form service if you want the form back.';

export function fidelity({ inventory, storyboard, runDir }) {
  const used = new Set(storyboard.pages.flatMap((p) => p.source_page_ids));
  const carried = inventory.pages.filter((p) => used.has(p.page_id));
  const forms = carried.flatMap((p) => p.forms);
  const fallback = new Set(forms.filter((f) => f.needs_backend).map((f) => f.form_id));

  const dropped = [];
  const drop = (ref, reason) => {
    if (!dropped.some((d) => d.ref === ref)) dropped.push({ ref, reason });
  };
  // A form the storyboard dropped but Lane C replaced with a call or email note is flagged, not dropped.
  for (const d of storyboard.dropped) if (!fallback.has(d.ref)) drop(d.ref, d.reason);
  for (const f of inventory.failures) drop(f.url, `The old page could not be read (${f.reason}), so nothing from it was carried over.`);
  for (const p of inventory.pages) if (!used.has(p.page_id)) drop(p.url, 'No page of the new site is built from this old page.');
  for (const f of forms) if (!f.needs_backend) drop(f.form_id, 'This form was not rebuilt on the new site.');
  const images = new Map(inventory.pages.flatMap((p) => p.images.map((i) => [i.image_id, i])));
  for (const id of storyboard.pages.flatMap((p) => p.sections.flatMap((s) => s.image_ids))) {
    const image = images.get(id);
    if (image && (!image.local_path || !existsSync(join(runDir, image.local_path)))) {
      drop(id, `The image ${image.src_url} could not be saved from the old site, so it is not on the new one.`);
    }
  }
  const outside = new Set(inventory.pages.flatMap((p) => p.links.filter((l) => !l.internal).map((l) => l.href)));
  for (const href of outside) drop(href, 'This link to another website was on the old site and is not on the new one.');

  return {
    pages_carried: carried.length,
    pages_total: inventory.pages.length + inventory.failures.length,
    dropped,
    flagged: [...fallback].map((ref) => ({ ref, reason: FORM_FALLBACK_REASON })),
  };
}
