// Fact diff: every fact Scout found on the old site (phone, email, address, date, time, person,
// legal notice, price) must still be on the new one. Facts whose block the new site does not show
// are skipped here and listed in the fidelity report instead (issue #14). A fact whose block is
// shown is judged only inside that block (and, for names, its section heading), so a copy that
// survives elsewhere cannot hide a change of any size (issue #16). A different phone or email in
// the block is reported as changed; anything else not found is missing. Both fail the gate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factsNotShown } from '../builder/content.mjs';
import { noDashes } from '../builder/text.mjs';
import { elementText, pageText, sectionText } from './html.mjs';

// Bounded repeats keep both linear on long scraped text (an unbounded email local part took 50 s on 200k chars).
const PHONE = /\+?\(?\d[\d\s().-]{5,25}\d/g;
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const digits = (s) => s.replace(/\D/g, '');
const words = (s) => noDashes(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function charsOff(a, b) {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// { ok: true } when the fact is in text, { after } for what replaced it, null when absent.
// Inside its own block a fact may be reworded ("Principal: Dana Whitfield"), so all its words count,
// and any other phone or email there is what replaced it, however many characters differ.
function find(fact, text, inBlock) {
  if (fact.kind === 'phone') {
    const want = digits(fact.value);
    const found = (text.match(PHONE) ?? []).map((c) => c.trim());
    if (found.some((c) => { const d = digits(c); return d.length >= 7 && (d.includes(want) || want.includes(d)); })) return { ok: true };
    const near = found.find((c) => charsOff(digits(c), want) <= 2) ?? (inBlock ? found[0] : undefined);
    return near ? { after: near } : null;
  }
  if (fact.kind === 'email') {
    const want = fact.value.toLowerCase();
    const found = (text.match(EMAIL) ?? []).map((e) => e.toLowerCase());
    if (found.includes(want)) return { ok: true };
    const near = found.find((e) => editDistance(e, want) <= 2) ?? (inBlock ? found[0] : undefined);
    return near ? { after: near } : null;
  }
  const want = words(fact.value);
  const have = words(text);
  if (` ${have} `.includes(` ${want} `)) return { ok: true };
  if (inBlock) {
    const set = new Set(have.split(' '));
    if (want.split(' ').every((w) => set.has(w))) return { ok: true };
  }
  return null;
}

export function factDiff({ dist, pages, inventory, storyboard }) {
  const notShown = new Set(factsNotShown(inventory, storyboard).map((f) => f.fact_id));
  const html = pages.map((p) => ({ slug: p.slug, html: readFileSync(join(dist, p.file), 'utf8') }));
  const site = html.map((p) => ({ slug: p.slug, text: pageText(p.html) }));
  const result = { checked: 0, changed: [], missing: [], failures: [] };

  for (const fact of inventory.facts) {
    // Its block is not on the new site (footer row, dropped or unused page): listed in fidelity.dropped instead.
    if (notShown.has(fact.fact_id)) continue;
    result.checked++;
    const homes = html.flatMap((p) => {
      const block = elementText(p.html, fact.block_id);
      return block === null ? [] : [{ slug: p.slug, block, section: sectionText(p.html, fact.block_id) ?? block }];
    });
    let change;
    if (homes.length) {
      // Its block is on the site, so it is judged there and nowhere else: a copy on another page,
      // or in the contact form note, cannot hide a change.
      // A legal notice's value is a label ("Nondiscrimination notice"), not its text: it is kept only when its own
      // block still holds the old block's full text, so a notice cut short or swapped for another still fails.
      if (fact.kind === 'legal_notice') {
        const source = inventory.pages.flatMap((p) => p.blocks).find((b) => b.block_id === fact.block_id)?.text;
        if (source && homes.some((h) => find({ kind: fact.kind, value: source }, h.block, true)?.ok)) continue;
      }
      const hits = homes.map((h) => ({ slug: h.slug, hit: find(fact, h.block, true) }));
      if (hits.some((h) => h.hit?.ok)) continue;
      // A name (a legal notice's, say) often lives in the section heading rather than the block.
      if (!['phone', 'email'].includes(fact.kind) && homes.some((h) => find(fact, h.section, false)?.ok)) continue;
      change = hits.find((h) => h.hit?.after);
    } else {
      // Its block was shortened into a headline, so the fact may be wherever the new copy put it.
      if (site.some((p) => find(fact, p.text, false)?.ok)) continue;
      change = site.map((p) => ({ slug: p.slug, hit: find(fact, p.text, false) })).find((h) => h.hit?.after);
    }
    if (change) {
      result.changed.push({ fact_id: fact.fact_id, before: fact.value, after: change.hit.after });
      result.failures.push(`fact ${fact.fact_id} (${fact.kind}) changed on ${change.slug}: "${fact.value}" is now "${change.hit.after}"`);
    } else {
      result.missing.push(fact.fact_id);
      const where = homes.length ? `on ${homes.map((h) => h.slug).join(', ')}` : 'anywhere on the site';
      result.failures.push(`fact ${fact.fact_id} (${fact.kind}) "${fact.value}" is not ${where}`);
    }
  }
  return result;
}
