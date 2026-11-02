// Brand of the home page from computed styles, read inside the visit that already has the page open.
const hex = (css) => {
  const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(css);
  if (!m || Number(m[4] ?? 1) === 0) return null;
  return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
};

export async function readBrand(page, images) {
  const raw = await page.evaluate(() => {
    const style = (el) => (el ? getComputedStyle(el) : null);
    const [body, h1, a, nav] = [document.body, ...['h1', 'a[href]', 'nav'].map((s) => document.querySelector(s))];
    const logo = [...document.images].find((i) => i.closest('header') || /logo|crest|seal/i.test(`${i.src} ${i.alt}`));
    return {
      background: style(body).backgroundColor,
      primary: style(h1)?.color,
      accent: style(a)?.color,
      nav: style(nav)?.backgroundColor,
      fonts: [['body', style(body)], ['headings', style(h1)], ['navigation', style(nav)]].map(([usage, s]) => [usage, s?.fontFamily]),
      logo: logo ? logo.currentSrc || logo.src : null,
    };
  });
  const colors = ['primary', 'accent', 'background', 'nav'].flatMap((role) => (hex(raw[role]) ? [{ hex: hex(raw[role]), role }] : []));
  const usages = new Map();
  for (const [usage, stack] of raw.fonts) {
    if (!stack) continue;
    const family = stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
    usages.set(family, [...(usages.get(family) ?? []), usage]);
  }
  const fonts = [...usages].map(([family, list]) => ({ family, usage: list.join(' and ') }));
  return { logo_path: images.find((i) => i.src_url === raw.logo)?.local_path ?? null, colors, fonts };
}
