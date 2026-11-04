// Storyboard plus selected direction to an Astro site in R/c-build/site/ (source and dist/).
// Page content goes in as data (src/data/site.json), never as generated code, so scraped text
// is always escaped by Astro.
import { cpSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildSite, TEMPLATE_DIR, WORK_ROOT } from '../lib/astro-build.mjs';
import { noDashesDeep } from './text.mjs';
import { selectedDirection } from './tokens.mjs';

const fileFor = (slug) => (slug === 'home' ? 'index' : slug);
// Every page sits at the site root, so relative links work served or opened from disk.
const hrefFor = (slug) => `./${fileFor(slug)}.html`;

export function siteData(storyboard, direction) {
  const { layout } = direction;
  return noDashesDeep({
    name: storyboard.organisation.name,
    lang: 'en',
    max_width_px: Number(layout.grid.match(/(\d+)\s*px/)?.[1] ?? 1200),
    nav: storyboard.nav.map(({ label, slug }) => ({ label, slug, href: hrefFor(slug) })),
    pages: storyboard.pages.map((page) => ({
      slug: page.slug,
      file: fileFor(page.slug),
      title: page.title,
      sections: page.sections.map((s) => ({
        id: s.section_id,
        intent: s.intent,
        pattern: s.intent === 'hero' ? layout.hero_pattern : (layout.section_patterns[s.intent] ?? null),
        headline: s.copy.headline,
        subhead: s.copy.subhead,
      })),
    })),
  });
}

export async function buildPages({ runDir, docs }) {
  const direction = selectedDirection(docs.directions, docs.selection);
  const site = siteData(docs.storyboard, direction);
  const workDir = join(WORK_ROOT, docs.run.run_id);
  try {
    await buildSite({ templateDir: TEMPLATE_DIR, tokens: direction.tokens, site, workDir });
    const siteDir = join(runDir, 'c-build', 'site');
    rmSync(siteDir, { recursive: true, force: true });
    cpSync(workDir, siteDir, { recursive: true, filter: (src) => !['node_modules', '.astro'].includes(basename(src)) });
    return { siteDir, workDir, pages: site.pages.map((p) => ({ slug: p.slug, path: `c-build/site/dist/${p.file}.html` })) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
