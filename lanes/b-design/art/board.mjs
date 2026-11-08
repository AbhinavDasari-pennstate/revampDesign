// One HTML board per direction with the site's real headlines, screenshotted at desktop and mobile size.
// Previews go to vision judges, so no image from the old site is drawn (plan T18: site images stay local);
// photos and the logo are neutral placeholders.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 3).map((w) => w[0]).join('') || 'S';

export function boardHtml(d, sb, { webFonts = true } = {}) {
  const c = d.tokens.color;
  const t = d.tokens.type;
  const [s0, s1, s2, s3] = t.scale_px;
  const home = sb.pages.find((p) => p.slug === 'home') ?? sb.pages[0];
  const [hero, ...rest] = home.sections;
  const contact = sb.nav.find((n) => /contact/i.test(n.slug))?.label ?? 'Get in touch';
  const band = d.direction_id === 'd2';
  const fonts = webFonts && t.source === 'google'
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${[t.display_family, t.body_family].map((f) => encodeURIComponent(f)).join('&family=')}&display=swap">`
    : '';
  const photo = d.imagery.strategy === 'site_photos' ? '<div class="photo" role="img" aria-label="Site photo placeholder">Site photo</div>' : '';
  const sections = rest.slice(0, 4).map((s) => `
    <section><h2>${esc(s.copy.headline)}</h2>${s.copy.subhead ? `<p>${esc(s.copy.subhead)}</p>` : ''}
      <div class="bar"></div><div class="bar"></div><div class="bar short"></div></section>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)}</title>${fonts}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: ${c.bg}; color: ${c.text}; font: ${s0}px/${t.line_height} "${t.body_family}", system-ui, sans-serif; }
  header, main { max-width: ${d.direction_id === 'd3' ? 1080 : 1200}px; margin: 0 auto; padding: 0 ${d.tokens.spacing_base_px * 3}px; }
  header { display: flex; align-items: center; gap: 24px; padding-block: 20px; flex-wrap: wrap; }
  .mark { width: 48px; height: 48px; border-radius: 50%; background: ${c.accent}; color: ${c.on_accent}; display: grid; place-items: center; font-weight: 700; }
  nav { display: flex; gap: 20px; flex-wrap: wrap; margin-left: auto; }
  nav a { color: ${c.accent}; text-decoration: none; font-weight: 600; }
  .hero { padding: ${d.tokens.spacing_base_px * 8}px 0; ${band ? `background: ${c.accent}; color: ${c.on_accent};` : ''} }
  .hero .inner { max-width: ${d.direction_id === 'd3' ? 1080 : 1200}px; margin: 0 auto; padding: 0 24px; display: grid; gap: 32px; grid-template-columns: ${photo ? '3fr 2fr' : '1fr'}; align-items: center; }
  h1, h2 { font-family: "${t.display_family}", Georgia, serif; line-height: 1.15; margin: 0 0 12px; }
  h1 { font-size: ${d.direction_id === 'd3' ? s3 * 1.2 : s3}px; }
  h2 { font-size: ${s2}px; }
  .lede { font-size: ${s1}px; max-width: 40ch; }
  .cta { display: inline-block; margin-top: 16px; padding: 12px 20px; border-radius: ${d.tokens.radius_px}px; background: ${band ? c.on_accent : c.accent}; color: ${band ? c.accent : c.on_accent}; font-weight: 700; text-decoration: none; }
  .photo { aspect-ratio: 4 / 3; border-radius: ${d.tokens.radius_px}px; background: ${c.surface}; color: ${c.muted}; display: grid; place-items: center; border: 2px dashed ${c.muted}; }
  main { display: grid; gap: 24px; padding-block: 48px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  section { background: ${c.surface}; border-radius: ${d.tokens.radius_px}px; padding: 24px; ${d.direction_id === 'd3' ? `border-top: 4px solid ${c.accent};` : ''} }
  .bar { height: 10px; border-radius: 5px; background: ${c.muted}; opacity: 0.3; margin: 10px 0; }
  .bar.short { width: 60%; }
  @media (max-width: 640px) { .hero .inner { grid-template-columns: 1fr; } nav { margin-left: 0; } }
</style></head>
<body>
<header><div class="mark" aria-hidden="true">${esc(initials(sb.organisation.name))}</div><strong>${esc(sb.organisation.name)}</strong>
  <nav aria-label="Main">${sb.nav.map((n) => `<a href="#${esc(n.slug)}">${esc(n.label)}</a>`).join('')}</nav></header>
<div class="hero"><div class="inner"><div><h1>${esc(hero.copy.headline)}</h1>
  <p class="lede">${esc(hero.copy.subhead ?? sb.organisation.one_message)}</p><a class="cta" href="#contact">${esc(contact)}</a></div>${photo}</div></div>
<main>${sections}</main>
</body></html>`;
}

// Writes b-design/boards/<id>.html and b-design/previews/<id>-{desktop,mobile}.png under the run folder.
export async function renderPreviews(runDir, directions, sb, opts = {}) {
  mkdirSync(join(runDir, 'b-design', 'boards'), { recursive: true });
  mkdirSync(join(runDir, 'b-design', 'previews'), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const d of directions) {
      const file = join(runDir, 'b-design', 'boards', `${d.direction_id}.html`);
      writeFileSync(file, boardHtml(d, sb, opts));
      for (const [kind, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        // A slow or blocked web font must not fail the stage; the board falls back to system fonts.
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
        await page.screenshot({ path: join(runDir, d.previews[kind]), fullPage: true });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
