// Builds the frozen sample fixture run (contracts/fixtures/sample/) from the fictional
// Maple Grove High School site in contracts/fixtures/sample-site/.
// Usage (from the repo root): node lanes/a-scout/tools/make-sample-fixture.mjs
// ponytail: hand-written stage outputs, not the real Scout. The real Scout (T08) replaces the capture half.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const site = join(root, 'contracts/fixtures/sample-site');
const out = join(root, 'contracts/fixtures/sample');
const ORIGIN = 'https://maplegrove-hs.example';
const RUN_ID = 'sample-0001';
const NOW = '2026-11-01T18:00:00-08:00';
const head = (contract) => ({ contract, version: '1.0.0', run_id: RUN_ID });
const write = (file, data) => {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  writeFileSync(join(out, file), JSON.stringify(data, null, 2) + '\n');
};
const touch = (file, text) => {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  writeFileSync(join(out, file), text);
};

// WCAG 2.1 contrast ratio between two #rrggbb colours.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// ---------- 00-run ----------
write('00-run.json', {
  ...head('run'),
  source_url: `${ORIGIN}/`,
  site_slug: 'maplegrove-hs',
  tier: 'A',
  consent: { owner_ok: true, note: 'Fictional site written for the contract fixtures. No real owner.' },
  created_at: NOW,
  limits: { max_pages: 40, lane_budget_usd: { a: 1, b: 4, c: 2 } },
});

// ---------- capture ----------
const types = { '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const file = join(site, req.url === '/' ? 'index.html' : req.url.slice(1));
  try {
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain' }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end('Not Found');
  }
}).listen(0);
const local = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const shot = async (url, file, width, height) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  mkdirSync(dirname(join(out, file)), { recursive: true });
  await page.screenshot({ path: join(out, file), fullPage: true });
  return page;
};

const pages = [['p01', 'index.html', 'Home'], ['p02', 'about.html', 'About Us'], ['p03', 'contact.html', 'Contact']];
for (const [id, file] of pages) {
  const page = await shot(`${local}/${file}`, `a-scout/screens/${id}-desktop.png`, 1280, 900);
  if (id === 'p01') await page.locator('img').screenshot({ path: join(out, 'a-scout/images/p01-i01.png') });
  await page.close();
  await (await shot(`${local}/${file}`, `a-scout/screens/${id}-mobile.png`, 390, 844)).close();
}

// ---------- 10-inventory ----------
const nav = [
  { href: '/index.html', text: 'Home', internal: true },
  { href: '/about.html', text: 'About Us', internal: true },
  { href: '/contact.html', text: 'Contact', internal: true },
  { href: '/calendar.html', text: 'Calendar', internal: true },
];
const b = (page, n, kind, text, level = null) => ({ block_id: `${page}-b${String(n).padStart(3, '0')}`, kind, level, order: n - 1, text });
const common = (id) => [
  b(id, 90, 'nav', 'Home | About Us | Contact | Calendar'),
  b(id, 91, 'footer', 'Copyright 2009 Maple Grove Local School District. Best viewed in Internet Explorer 8 at 1024x768.'),
];
const pageEntry = (id, file, title, blocks, extra = {}) => ({
  page_id: id, url: `${ORIGIN}/${file}`, title: `${title} - Maple Grove High School`, status_code: 200, depth: id === 'p01' ? 0 : 1,
  screenshots: { desktop: `a-scout/screens/${id}-desktop.png`, mobile: `a-scout/screens/${id}-mobile.png` },
  blocks: [...blocks, ...common(id)], images: [], links: nav, forms: [], ...extra,
});

write('10-inventory.json', {
  ...head('inventory'),
  crawled_at: NOW,
  robots_respected: true,
  pages: [
    pageEntry('p01', 'index.html', 'Home', [
      b('p01', 1, 'heading', 'Welcome to Maple Grove High School', 1),
      b('p01', 2, 'paragraph', 'Maple Grove High School serves about 640 students in grades 9 through 12 in the Maple Grove Local School District. Our mission is to prepare every student for college, career and community life.'),
      b('p01', 3, 'list', 'News and Announcements\nFall parent teacher conferences are November 12 and 13.\nThe Mustangs marching band placed second at the state competition.\nSenior photos are due to the main office by December 1.'),
      b('p01', 4, 'contact', 'Questions? Call the main office at (555) 010-0142.'),
    ], {
      images: [{ image_id: 'p01-i01', src_url: `${ORIGIN}/crest.svg`, local_path: 'a-scout/images/p01-i01.png', alt: 'Maple Grove High School crest', width: 64, height: 64, origin: 'site' }],
    }),
    pageEntry('p02', 'about.html', 'About Us', [
      b('p02', 1, 'heading', 'About Us', 1),
      b('p02', 2, 'paragraph', 'Maple Grove High School opened in 1962 and moved to its current building on Orchard Road in 1998. Students choose from 14 Advanced Placement courses, a career and technical program, and more than 30 clubs and teams.'),
      b('p02', 3, 'paragraph', 'Principal: Dana Whitfield'),
      b('p02', 4, 'legal', 'Maple Grove Local School District does not discriminate on the basis of race, color, national origin, sex, disability or age in its programs and activities.'),
    ]),
    pageEntry('p03', 'contact.html', 'Contact', [
      b('p03', 1, 'heading', 'Contact', 1),
      b('p03', 2, 'contact', 'Maple Grove High School\n2200 Orchard Road\nMaple Grove, OH 45000'),
      b('p03', 3, 'contact', 'Phone: (555) 010-0142\nEmail: office@maplegrove-hs.example'),
      b('p03', 4, 'paragraph', 'Office hours: Monday to Friday, 7:30 AM to 3:30 PM'),
    ], {
      forms: [{
        form_id: 'p03-f01', action: '/cgi-bin/contact.pl', method: 'post', needs_backend: true,
        fields: [
          { name: 'name', type: 'text', label: 'Your name', required: false },
          { name: 'email', type: 'text', label: 'Your email', required: false },
          { name: 'message', type: 'textarea', label: 'Message', required: false },
        ],
      }],
    }),
  ],
  facts: [
    { fact_id: 'f001', kind: 'phone', value: '(555) 010-0142', block_id: 'p03-b003' },
    { fact_id: 'f002', kind: 'email', value: 'office@maplegrove-hs.example', block_id: 'p03-b003' },
    { fact_id: 'f003', kind: 'address', value: '2200 Orchard Road, Maple Grove, OH 45000', block_id: 'p03-b002' },
    { fact_id: 'f004', kind: 'date', value: '1962', block_id: 'p02-b002' },
    { fact_id: 'f005', kind: 'person', value: 'Dana Whitfield, Principal', block_id: 'p02-b003' },
    { fact_id: 'f006', kind: 'legal_notice', value: 'Nondiscrimination notice', block_id: 'p02-b004' },
    { fact_id: 'f007', kind: 'time', value: 'Monday to Friday, 7:30 AM to 3:30 PM', block_id: 'p03-b004' },
    { fact_id: 'f008', kind: 'date', value: 'November 12 and 13', block_id: 'p01-b003' },
  ],
  brand: {
    logo_path: 'a-scout/images/p01-i01.png',
    colors: [
      { hex: '#003366', role: 'primary' }, { hex: '#ffcc00', role: 'accent' },
      { hex: '#fffff0', role: 'background' }, { hex: '#cccccc', role: 'nav' },
    ],
    fonts: [{ family: 'Times New Roman', usage: 'headings and body' }, { family: 'Arial', usage: 'navigation and footer' }],
  },
  failures: [{ url: `${ORIGIN}/calendar.html`, reason: 'HTTP 404' }],
  untrusted_text: true,
});

// ---------- 20-storyboard ----------
const sec = (n, intent, blocks, headline, subhead, status = 'verbatim', from = null, images = []) => ({
  section_id: `s${String(n).padStart(3, '0')}`, intent, body_block_ids: blocks, image_ids: images,
  copy: { headline, subhead }, copy_status: status, edited_from_block_id: from,
});
write('20-storyboard.json', {
  ...head('storyboard'),
  organisation: {
    name: 'Maple Grove High School',
    what_it_does: 'A public high school for about 640 students in grades 9 to 12, with AP courses, a career and technical program and more than 30 clubs and teams.',
    audiences: ['Current families', 'Prospective families', 'Students', 'Community members'],
    one_message: 'Every Mustang leaves ready for college, career and community life.',
  },
  tier: 'A',
  pages: [
    { slug: 'home', title: 'Home', purpose: 'Say who the school is and what is happening now.', source_page_ids: ['p01'], sections: [
      sec(1, 'hero', ['p01-b002'], 'Ready for college, career and community', 'About 640 students in grades 9 to 12', 'edited', 'p01-b002', ['p01-i01']),
      sec(2, 'news', ['p01-b003'], 'News and announcements', null),
      sec(3, 'cta', ['p01-b004'], 'Questions? Call the main office', null),
    ] },
    { slug: 'about', title: 'About', purpose: 'Show history, programs and leadership.', source_page_ids: ['p02'], sections: [
      sec(4, 'story', ['p02-b002'], 'Since 1962', null, 'new'),
      sec(5, 'people', ['p02-b003'], 'Leadership', null),
      sec(6, 'legal', ['p02-b004'], 'Nondiscrimination notice', null),
    ] },
    { slug: 'contact', title: 'Contact', purpose: 'Make it easy to reach the office.', source_page_ids: ['p03'], sections: [
      sec(7, 'contact', ['p03-b002', 'p03-b003', 'p03-b004'], 'Visit or call', null),
    ] },
  ],
  nav: [{ label: 'Home', slug: 'home' }, { label: 'About', slug: 'about' }, { label: 'Contact', slug: 'contact' }],
  dropped: [
    { ref: `${ORIGIN}/calendar.html`, reason: 'Linked page returns 404. Flag for the owner.' },
    { ref: 'p03-f01', reason: 'Contact form posts to a CGI script. Needs a backend, replaced by phone and email.' },
  ],
});

// ---------- 30-directions ----------
const directions = [
  { id: 'd1', name: 'Orchard Road', concept: 'Calm and civic. Generous type, plain sections, no motion. Built to pass WCAG 2.1 AA with room to spare.',
    color: { bg: '#f7f8f5', surface: '#ffffff', text: '#1d2a22', muted: '#55625a', accent: '#1f5f3f', on_accent: '#ffffff' },
    type: ['Source Serif 4', 'Source Sans 3'], scale: [16, 20, 28, 40], radius: 4, motion: 'none',
    layout: { grid: '12 column, 1120 px max', hero_pattern: 'headline left, crest right', section_patterns: { news: 'dated list', contact: 'two column card' } },
    refs: [{ url: 'https://www.gov.uk/', why: 'Plain language and accessible structure' }] },
  { id: 'd2', name: 'Mustang Gold', concept: 'School pride. Navy and gold from the crest, bold headings, one subtle reveal on scroll.',
    color: { bg: '#ffffff', surface: '#f2f5f9', text: '#0f1f33', muted: '#4a5a6e', accent: '#003366', on_accent: '#ffcc00' },
    type: ['Archivo', 'Public Sans'], scale: [16, 22, 32, 52], radius: 8, motion: 'subtle',
    layout: { grid: '12 column, 1200 px max', hero_pattern: 'full width navy band with crest', section_patterns: { news: 'three cards', story: 'image and text split' } },
    refs: [{ url: 'https://trionn.com/', why: 'Confident type scale and section rhythm' }] },
  { id: 'd3', name: 'Bulletin Board', concept: 'Editorial and type led, like a printed school bulletin. Big dates, strong grid, no photos needed.',
    color: { bg: '#fbf9f4', surface: '#ffffff', text: '#222222', muted: '#5c5c5c', accent: '#b3261e', on_accent: '#ffffff' },
    type: ['Fraunces', 'Atkinson Hyperlegible'], scale: [17, 22, 34, 60], radius: 0, motion: 'none',
    layout: { grid: '6 column, 1080 px max', hero_pattern: 'oversized headline with date stamp', section_patterns: { news: 'numbered bulletin', events: 'date column' } },
    refs: [{ url: 'https://www.apple.com/', why: 'Restraint and spacing' }] },
];
const board = (d) => `<!doctype html><html><head><meta charset="utf-8"><title>${d.name}</title><style>
body{margin:0;background:${d.color.bg};color:${d.color.text};font:${d.scale[0]}px/1.5 Georgia,serif}
header{background:${d.color.accent};color:${d.color.on_accent};padding:48px 40px}
h1{font-size:${d.scale[3]}px;margin:0 0 8px;line-height:1.1}p{max-width:60ch}
main{padding:32px 40px;display:grid;gap:16px}
.card{background:${d.color.surface};padding:20px;border-radius:${d.radius}px;border:1px solid ${d.color.muted}33}
small{color:${d.color.muted}}</style></head><body>
<header><small style="color:inherit">${d.name}</small><h1>Ready for college, career and community</h1><p>About 640 students in grades 9 to 12</p></header>
<main><div class="card"><b>News and announcements</b><p>Fall parent teacher conferences are November 12 and 13.</p></div>
<div class="card"><b>Visit or call</b><p>2200 Orchard Road. Phone (555) 010-0142.</p></div></main></body></html>`;
for (const d of directions) {
  touch(`b-design/boards/${d.id}.html`, board(d));
  for (const [form, w, h] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
    const page = await shot(`file://${join(out, `b-design/boards/${d.id}.html`)}`, `b-design/previews/${d.id}-${form}.png`, w, h);
    await page.close();
  }
}
write('30-directions.json', {
  ...head('directions'),
  directions: directions.map((d) => ({
    direction_id: d.id, name: d.name, concept: d.concept,
    tokens: {
      color: d.color,
      type: { display_family: d.type[0], body_family: d.type[1], source: 'google', scale_px: d.scale, line_height: 1.5 },
      radius_px: d.radius, spacing_base_px: 8,
      motion: { level: d.motion, reduced_motion_ok: true },
    },
    layout: d.layout,
    references: d.refs,
    imagery: { strategy: d.id === 'd3' ? 'type_only' : 'site_photos', generated: [] },
    previews: { desktop: `b-design/previews/${d.id}-desktop.png`, mobile: `b-design/previews/${d.id}-mobile.png` },
    contrast_checks: [
      { fg: d.color.text, bg: d.color.bg, ratio: contrast(d.color.text, d.color.bg) },
      { fg: d.color.on_accent, bg: d.color.accent, ratio: contrast(d.color.on_accent, d.color.accent) },
      { fg: d.color.muted, bg: d.color.bg, ratio: contrast(d.color.muted, d.color.bg) },
    ],
  })),
  banned_patterns_checked: ['purple to blue gradient hero', 'default component theme', 'emoji section markers', 'everything centered'],
});

// ---------- 40-verdict ----------
const judges = [
  { model_id: 'anthropic/claude-sonnet-5-5', family: 'anthropic' },
  { model_id: 'google/gemini-pro', family: 'google' },
  { model_id: 'openai/gpt-vision', family: 'openai' },
];
const votes = { 'd1-d2': ['d2', 'd2', 'd1'], 'd1-d3': ['d1', 'd3', 'd1'], 'd2-d3': ['d2', 'd2', 'd2'] };
const pairs = Object.entries(votes).flatMap(([key, winners]) => winners.map((winner, i) => {
  const [a, bb] = key.split('-');
  return { a, b: bb, order_shown: i % 2 ? 'ba' : 'ab', judge: judges[i].model_id, winner, rationale: `Fixture vote: ${winner} reads as clearer for families.` };
}));
const wins = (id) => pairs.filter((p) => p.winner === id).length;
write('40-verdict.json', {
  ...head('verdict'),
  judges, rubric_version: 'rubric-1',
  pairs,
  ranking: ['d2', 'd1', 'd3'].map((id) => ({ direction_id: id, wins: wins(id), score: Math.round((wins(id) / 6) * 100) / 100 })),
  top_direction_id: 'd2', agreement: 0.78, needs_human: false,
  calibration: { set_version: 'calibration-1', accuracy: 0.92, passed: true, measured_at: NOW },
  compare_path: 'b-design/compare.html', cost_usd: 0,
});
touch('b-design/compare.html', `<!doctype html><title>Compare directions</title>${directions.map((d) => `<figure><img src="previews/${d.id}-desktop.png" alt="${d.name} preview" width="640"><figcaption>${d.name}</figcaption></figure>`).join('')}`);

// ---------- 45-selection ----------
write('45-selection.json', { ...head('selection'), direction_id: 'd2', chosen_by: 'council', reason: 'Top of the council ranking with 6 of 9 votes. No tie.', chosen_at: NOW });

// ---------- 50-handoff ----------
const slugs = ['home', 'about', 'contact'];
mkdirSync(join(out, 'c-build/screens'), { recursive: true });
for (const slug of slugs) {
  touch(`c-build/site/dist/${slug === 'home' ? 'index' : slug}.html`, `<!doctype html><title>${slug}</title><p>Fixture stand-in for the built ${slug} page.</p>`);
  // Stand-in screenshots: the chosen direction's previews, until Lane C builds a real site.
  for (const form of ['desktop', 'mobile']) copyFileSync(join(out, `b-design/previews/d2-${form}.png`), join(out, `c-build/screens/${slug}-${form}.png`));
}
touch('c-build/axe.json', '{ "violations": [] }\n');
touch('c-build/report.md', '# Maple Grove High School redesign report (fixture)\n\nAll three pages carried over. The Calendar page returned 404 on the old site and is listed for the owner. The contact form needed a backend and was replaced by phone and email.\n');
write('50-handoff.json', {
  ...head('handoff'),
  status: 'pass',
  site: {
    repo_path: 'c-build/site', preview_url: null, preview_local: 'c-build/site/dist',
    pages: slugs.map((slug) => ({
      slug, path: `c-build/site/dist/${slug === 'home' ? 'index' : slug}.html`,
      screenshots: { desktop: `c-build/screens/${slug}-desktop.png`, mobile: `c-build/screens/${slug}-mobile.png` },
    })),
  },
  qa: {
    axe: { serious: 0, critical: 0, report_path: 'c-build/axe.json' },
    lighthouse: slugs.map((slug) => ({ slug, form_factor: 'mobile', accessibility: 100, performance: 98, best_practices: 100 })),
    links: { checked: 12, broken: [] },
    fact_diff: { checked: 8, changed: [], missing: [] },
    gates_passed: true,
  },
  fidelity: {
    pages_carried: 3, pages_total: 4,
    dropped: [{ ref: `${ORIGIN}/calendar.html`, reason: 'Returned 404 on the old site' }],
    flagged: [{ ref: 'p03-f01', reason: 'Contact form needs a backend; replaced by phone and email' }],
  },
  report_path: 'c-build/report.md', cost_usd: 0,
});

await browser.close();
server.close();
console.log(`sample fixture written to ${out}`);
