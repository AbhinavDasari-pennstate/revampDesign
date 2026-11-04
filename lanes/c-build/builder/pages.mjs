// Storyboard plus selected direction to an Astro site in R/c-build/site/ (source and dist/).
// Page content goes in as data (src/data/site.json), never as generated code, so scraped text
// is always escaped by Astro.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildSite, TEMPLATE_DIR, WORK_ROOT } from '../lib/astro-build.mjs';
import { formFallbacks, indexInventory, sectionBlocks, sectionImages } from './content.mjs';
import { noDashesDeep } from './text.mjs';
import { selectedDirection } from './tokens.mjs';

const fileFor = (slug) => (slug === 'home' ? 'index' : slug);
// Every page sits at the site root, so relative links work served or opened from disk.
const hrefFor = (slug) => `./${fileFor(slug)}.html`;

// Site data for the template. Image `from` paths (relative to the run folder) say which files to copy in.
export function siteData({ storyboard, inventory }, direction, runDir) {
  const { layout } = direction;
  const index = indexInventory(inventory);
  return noDashesDeep({
    name: storyboard.organisation.name,
    lang: 'en',
    max_width_px: Number(layout.grid.match(/(\d+)\s*px/)?.[1] ?? 1200),
    nav: storyboard.nav.map(({ label, slug }) => ({ label, slug, href: hrefFor(slug) })),
    pages: storyboard.pages.map((page) => {
      const sections = page.sections.map((s) => ({
        id: s.section_id,
        intent: s.intent,
        pattern: s.intent === 'hero' ? layout.hero_pattern : (layout.section_patterns[s.intent] ?? null),
        headline: s.copy.headline,
        subhead: s.copy.subhead,
        blocks: sectionBlocks(s, index),
        images: sectionImages(s, index, runDir),
        forms: [],
      }));
      // Form fallbacks sit in the contact section, or at the end of the page when there is none.
      const home = sections.find((s) => s.intent === 'contact') ?? sections.at(-1);
      home.forms = formFallbacks(page, index);
      return { slug: page.slug, file: fileFor(page.slug), title: page.title, sections };
    }),
  });
}

export async function buildPages({ runDir, docs }) {
  const direction = selectedDirection(docs.directions, docs.selection);
  const site = siteData(docs, direction, runDir);
  const images = site.pages.flatMap((p) => p.sections.flatMap((s) => s.images));
  const assets = images.map((i) => ({ from: join(runDir, i.from), to: join('public', i.src) }));
  for (const i of images) delete i.from;
  // A fresh folder per build, so two builds of one run (or two tests) never share one.
  mkdirSync(WORK_ROOT, { recursive: true });
  const workDir = mkdtempSync(join(WORK_ROOT, `${docs.run.run_id}-`));
  try {
    await buildSite({ templateDir: TEMPLATE_DIR, tokens: direction.tokens, site, assets, workDir });
    const siteDir = join(runDir, 'c-build', 'site');
    rmSync(siteDir, { recursive: true, force: true });
    cpSync(workDir, siteDir, { recursive: true, filter: (src) => !['node_modules', '.astro'].includes(basename(src)) });
    return { siteDir, workDir, pages: site.pages.map((p) => ({ slug: p.slug, path: `c-build/site/dist/${p.file}.html` })) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
