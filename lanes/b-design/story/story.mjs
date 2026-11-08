// Storyteller: inventory.v1 to storyboard.v1. The draft is built by rules from the inventory, so it works with no key
// and never invents facts. --live asks a model to improve the draft; its reply is kept only if it passes every check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../lib/contracts.mjs';
import { fence, parseJson } from '../lib/openrouter.mjs';

const PROMPT = readFileSync(join(import.meta.dirname, 'prompt.md'), 'utf8');
const SKIP = new Set(['nav', 'footer']);
const CONTACT_FACTS = new Set(['phone', 'email', 'address', 'time']);
const INTENTS = [
  ['news', /\b(news|announcements?|updates?)\b/i],
  ['events', /\b(events?|calendar|upcoming)\b/i],
  ['people', /\b(staff|leadership|principal|faculty|team|directory|board)\b/i],
  ['programs', /\b(programs?|academics?|courses?|curriculum|athletics|clubs)\b/i],
  ['contact', /\b(contact|visit us|directions|office hours)\b/i],
  ['faq', /\b(faq|questions)\b/i],
  ['gallery', /\b(gallery|photos)\b/i],
];
const LABEL = { hero: 'Welcome', story: 'Our story', proof: 'Highlights', programs: 'Programs', people: 'People', news: 'News', events: 'Events', contact: 'Get in touch', cta: 'Get involved', legal: 'Notices', faq: 'Questions', gallery: 'Gallery' };
const SEP = /\s+[-|:\u2013\u2014]\s+/;

const intentOf = (text) => INTENTS.find(([, re]) => re.test(text))?.[0];
const firstLine = (text) => text.split('\n')[0];
const labelled = (b) => b.kind === 'list' && Boolean(intentOf(firstLine(b.text)));
// Legacy sites set headings as short bold paragraphs ("News and Announcements"): one line, six words or fewer,
// no closing punctuation, no digits or emails (so a fact never becomes a headline).
const looksHeading = (b) => b.kind === 'paragraph' && !b.text.includes('\n') && b.text.trim().split(/\s+/).length <= 6
  && !/[.!?:,;]/.test(b.text) && !/\d|@/.test(b.text);

function slugFor(url) {
  const parts = new URL(url).pathname.split('/').filter((s) => s && !/^(index|default|home)(\.\w+)?$/i.test(s));
  const last = (parts.pop() ?? '').replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return last || 'home';
}

function orgName(run, inv) {
  const tails = inv.pages.map((p) => p.title.split(SEP)).filter((t) => t.length > 1).map((t) => t.at(-1).trim());
  const count = (t) => tails.filter((x) => x === t).length;
  const best = [...tails].sort((a, b) => count(b) - count(a))[0];
  if (best && (count(best) > 1 || inv.pages.length === 1)) return best;
  const h1 = inv.pages[0]?.blocks.find((b) => b.kind === 'heading' && b.level === 1)?.text;
  return h1 ? h1.replace(/^welcome to (the )?/i, '').trim() : run.site_slug;
}

export function draftStory(run, inv) {
  const factKinds = new Map();
  for (const f of inv.facts) factKinds.set(f.block_id, [...(factKinds.get(f.block_id) ?? []), f.kind]);
  const isContact = (b) => b.kind === 'contact' || (b.kind === 'paragraph' && (factKinds.get(b.block_id) ?? []).some((k) => CONTACT_FACTS.has(k)));

  const linkText = new Map();
  for (const p of inv.pages) for (const l of p.links) if (l.internal && l.text?.trim()) {
    try { const href = new URL(l.href, p.url).href; if (!linkText.has(href)) linkText.set(href, l.text.trim()); } catch {}
  }

  // Site chrome: the same text block on two or more pages (a banner, a tagline). Carried once, where it first appears.
  const firstPage = new Map();
  const repeats = new Map();
  for (const p of inv.pages) for (const b of p.blocks) {
    if (SKIP.has(b.kind) || b.kind === 'heading') continue;
    if (!firstPage.has(b.text)) firstPage.set(b.text, p.page_id);
    else if (firstPage.get(b.text) !== p.page_id) repeats.set(b.text, true);
  }
  const chrome = (b, page) => repeats.has(b.text) && firstPage.get(b.text) !== page.page_id;

  const dropped = [];
  const pages = [];
  const slugs = new Set();
  let n = 0;
  const sid = () => `s${String(++n).padStart(3, '0')}`;
  // Section ids stop at s999: each page gets an even share (one kept back for a fact contact section), extra
  // groups merge into the page's last section so no block is lost. 40 pages still leave 23 sections each.
  const perPage = Math.max(1, Math.floor(999 / Math.max(1, inv.pages.length)) - 1);

  inv.pages.forEach((page, i) => {
    const blocks = page.blocks.filter((b) => !SKIP.has(b.kind) && !chrome(b, page)).sort((a, b) => a.order - b.order);
    const h1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
    const groups = [];
    let cur = null;
    for (const b of blocks) {
      if (b === h1) continue;
      if (b.kind === 'heading' || looksHeading(b)) { cur = { heading: b, body: [] }; groups.push(cur); continue; }
      const kind = b.kind === 'legal' ? 'legal' : isContact(b) ? 'contact' : null;
      if (kind && !(kind === 'contact' && cur?.intent === 'contact')) { cur = { heading: null, intent: kind, body: [] }; groups.push(cur); }
      // A list titled by its first line ("News and Announcements") starts its own section when no heading did.
      else if (!kind && (!cur || (cur.intent && !cur.heading) || (!cur.heading && labelled(b)))) { cur = { heading: null, body: [] }; groups.push(cur); }
      cur.body.push(b);
    }
    // A bold line with nothing under it was copy after all: keep it as a body block, never lose it.
    for (const g of groups) if (!g.body.length && g.heading?.kind === 'paragraph') { g.body.push(g.heading); g.heading = null; }
    const kept = groups.filter((g) => g.body.length);
    if (kept.length > perPage) kept.splice(perPage - 1, Infinity, { ...kept[perPage - 1], body: kept.slice(perPage - 1).flatMap((g) => g.body) });
    if (!kept.length) { dropped.push({ ref: page.page_id, reason: 'Page has no text content to carry over.' }); return; }

    let slug = i === 0 ? 'home' : slugFor(page.url);
    for (let k = 2; slugs.has(slug); k++) slug = `${slugFor(page.url)}-${k}`;
    slugs.add(slug);
    const title = i === 0 ? 'Home' : linkText.get(page.url) ?? h1?.text ?? page.title.split(SEP)[0];
    const images = page.images.filter((im) => im.origin !== 'third_party').map((im) => im.image_id);

    const sections = kept.map((g, k) => {
      // Intent comes from a heading or a list's title line, never from body prose (one word like "clubs" misleads).
      const lead = g.heading?.text ?? (labelled(g.body[0]) ? firstLine(g.body[0].text) : '');
      const intent = g.intent ?? intentOf(lead) ?? (i === 0 && k === 0 ? 'hero' : 'story');
      const verbatim = g.heading ?? (k === 0 ? h1 : null);
      return {
        section_id: sid(),
        intent,
        body_block_ids: g.body.map((b) => b.block_id),
        image_ids: k === 0 ? images : [],
        copy: { headline: verbatim ? verbatim.text : LABEL[intent], subhead: null },
        copy_status: verbatim ? 'verbatim' : 'new',
        edited_from_block_id: null,
      };
    });
    pages.push({ slug, title, purpose: `Carry over the ${title} page.`, source_page_ids: [page.page_id], sections });
  });

  // Every fact must be rendered or listed as dropped by its block id, so the fact diff never fails on a block we left out.
  const used = new Set(pages.flatMap((p) => p.sections.flatMap((s) => s.body_block_ids)));
  const pageOf = (blockId) => pages.find((p) => p.source_page_ids.includes(blockId.slice(0, 3)));
  for (const f of inv.facts) {
    if (used.has(f.block_id) || dropped.some((d) => d.ref === f.block_id)) continue;
    const target = pageOf(f.block_id);
    if (target && CONTACT_FACTS.has(f.kind)) {
      let sec = target.sections.find((s) => s.intent === 'contact');
      if (!sec) target.sections.push(sec = { section_id: sid(), intent: 'contact', body_block_ids: [], image_ids: [], copy: { headline: LABEL.contact, subhead: null }, copy_status: 'new', edited_from_block_id: null });
      sec.body_block_ids.push(f.block_id);
      used.add(f.block_id);
    } else {
      const block = inv.pages.flatMap((p) => p.blocks).find((b) => b.block_id === f.block_id);
      const why = target ? `old ${block?.kind ?? 'page'} text, the new site writes its own` : 'its page was not carried over';
      dropped.push({ ref: f.block_id, reason: `Holds the ${f.kind} "${f.value}" but is not carried over: ${why}.` });
    }
  }
  for (const fail of inv.failures) dropped.push({ ref: fail.url, reason: `Page could not be read (${fail.reason}). Flag for the owner.` });
  for (const form of inv.pages.flatMap((p) => p.forms)) dropped.push({
    ref: form.form_id,
    reason: form.needs_backend ? 'Form needs a backend. The new site points people to the phone and email instead.' : 'Form not carried over this week. Flag for the owner.',
  });

  const name = orgName(run, inv);
  const allText = inv.pages.flatMap((p) => p.blocks.map((b) => b.text)).join(' ');
  const what = inv.pages[0]?.blocks.find((b) => b.kind === 'paragraph')?.text ?? name;
  return {
    contract: 'storyboard', version: '1.0.0', run_id: run.run_id,
    organisation: {
      name,
      what_it_does: what,
      audiences: /\b(school|students?|pupils?)\b/i.test(allText) ? ['Current families', 'Prospective families', 'Students', 'Community members'] : ['Visitors', 'Community members'],
      one_message: what.split(/(?<=\.)\s/)[0],
    },
    tier: run.tier,
    pages,
    nav: pages.map((p) => ({ label: p.title, slug: p.slug })),
    dropped,
  };
}

// Checks the schema cannot express. Returns a list of problems (empty means the storyboard is safe to hand on).
export function gate(sb, inv) {
  const problems = [];
  const blocks = new Set(inv.pages.flatMap((p) => p.blocks.map((b) => b.block_id)));
  const images = new Set(inv.pages.flatMap((p) => p.images.map((im) => im.image_id)));
  const refs = new Set(sb.dropped.map((d) => d.ref));
  const used = new Set();
  if (!sb.pages.length) problems.push('no page of the inventory has text to carry over');
  const textOn = new Map(inv.pages.map((p) => [p.page_id, new Set(p.blocks.map((b) => b.text.trim()))]));
  for (const p of sb.pages) for (const s of p.sections) {
    // Verbatim copy must really be a block from this page; anything else is new copy and gets the fact check.
    const fromPage = (t) => t == null || p.source_page_ids.some((id) => textOn.get(id)?.has(t.trim()));
    if (s.copy_status === 'verbatim' && !(fromPage(s.copy.headline) && fromPage(s.copy.subhead))) problems.push(`${s.section_id}: verbatim copy is not the text of a block on its source pages`);
    for (const id of s.body_block_ids) { used.add(id); if (!blocks.has(id)) problems.push(`${s.section_id}: block ${id} is not in the inventory`); }
    for (const id of s.image_ids) if (!images.has(id)) problems.push(`${s.section_id}: image ${id} is not in the inventory`);
    if (s.edited_from_block_id && !blocks.has(s.edited_from_block_id)) problems.push(`${s.section_id}: edited_from_block_id ${s.edited_from_block_id} is not in the inventory`);
    if (s.copy_status === 'edited' && !s.edited_from_block_id) problems.push(`${s.section_id}: edited copy needs edited_from_block_id`);
    if (s.copy_status !== 'verbatim' && /\d|@/.test(`${s.copy.headline} ${s.copy.subhead ?? ''}`)) problems.push(`${s.section_id}: ${s.copy_status} copy has a digit or email; facts must come from blocks`);
  }
  const sourced = new Set(sb.pages.flatMap((p) => p.source_page_ids));
  for (const p of inv.pages) if (!sourced.has(p.page_id) && !refs.has(p.page_id) && !refs.has(p.url)) problems.push(`page ${p.page_id} is neither used nor dropped`);
  for (const f of inv.facts) if (!used.has(f.block_id) && !refs.has(f.block_id)) problems.push(`fact ${f.fact_id} block ${f.block_id} is neither rendered nor dropped`);
  const slugs = sb.pages.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length) problems.push('page slugs are not unique');
  for (const item of sb.nav) if (!slugs.includes(item.slug)) problems.push(`nav slug ${item.slug} has no page`);
  return problems;
}

// Any string bound for a model that contains a person block's text or a person fact's name is withheld (plan
// Off-limits: no names to providers). ponytail: only as good as Scout's person facts, and Scout extracts none this
// week, so on real runs --live sends names that appear in body text. Needs a name detector or a ruling.
export function scrub(value, inv) {
  const people = inv.facts.filter((f) => f.kind === 'person');
  const ids = new Set(people.map((f) => f.block_id));
  const needles = [
    ...inv.pages.flatMap((p) => p.blocks).filter((b) => ids.has(b.block_id)).map((b) => b.text.trim()),
    ...people.flatMap((f) => [f.value, f.value.split(',')[0]]).map((s) => s.trim()),
  ].filter(Boolean);
  return JSON.parse(JSON.stringify(value), (_, v) => (typeof v === 'string' && needles.some((s) => v.includes(s)) ? '[withheld: names a person]' : v));
}

const forModel = (inv) => inv.pages.map((p) => ({ page_id: p.page_id, url: p.url, title: p.title,
  blocks: p.blocks.filter((b) => !SKIP.has(b.kind)).map((b) => ({ id: b.block_id, kind: b.kind, text: b.text })) }));

export async function story({ run, inventory, ask, live, models, log = console.error }) {
  const draft = draftStory(run, inventory);
  if (!live) return { doc: draft, problems: gate(draft, inventory) };
  const reply = await ask({ model: models.story, messages: [
    { role: 'system', content: PROMPT },
    { role: 'user', content: `${fence('inventory', scrub(forModel(inventory), inventory))}\n${fence('draft', scrub(draft, inventory))}` },
  ] });
  try {
    const doc = { ...parseJson(reply), contract: 'storyboard', version: '1.0.0', run_id: run.run_id, tier: run.tier };
    const err = check(doc);
    const problems = err ? [err] : gate(doc, inventory);
    if (!problems.length) return { doc, problems };
    log(`story: model reply failed checks, using the rule draft: ${problems.slice(0, 5).join('; ')}`);
  } catch (e) {
    log(`story: model reply unusable, using the rule draft: ${e.message}`);
  }
  return { doc: draft, problems: gate(draft, inventory) };
}
