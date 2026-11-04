// Brand of the home page from computed styles, read inside the visit that already has the page open.
const hex = (css) => {
  const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(css);
  if (!m || Number(m[4] ?? 1) === 0) return null;
  return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
};

export async function readBrand(page, images) {
  const raw = await page.evaluate(() => {
    // Computed colours can be oklch(), oklab() or color(srgb ...): let a 1x1 canvas turn them into rgb. An unparsable one stays transparent.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgb = (c) => {
      if (!c || /^rgba?\(/.test(c)) return c;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a === 255 ? `rgb(${r}, ${g}, ${b})` : a === 0 ? 'rgba(0, 0, 0, 0)' : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
    };
    const style = (el) => (el ? new Proxy(getComputedStyle(el), { get: (s, k) => (/[cC]olor$/.test(k) ? rgb(s[k]) : s[k]) }) : null);
    const [body, h1, a, nav] = [document.body, ...['h1', 'a[href]', 'nav'].map((s) => document.querySelector(s))];
    const logo = [...document.images].find((i) => i.closest('header') || /logo|crest|seal/i.test(`${i.src} ${i.alt}`));
    // The school colour is usually a header background: header, nav, then the first element near the page top that has one.
    const clear = (c) => /^rgba\(.*, 0\)$/.test(c);
    const bodyBackground = style(body)?.backgroundColor;
    const pageBackground = clear(bodyBackground ?? 'rgba(0, 0, 0, 0)') ? style(document.documentElement).backgroundColor : bodyBackground;
    const top = [...document.querySelectorAll('td,th,div,section')].filter((el) => el.getBoundingClientRect().top < 300);
    // Only a visible, non-white band counts: not hidden, not a fixed cookie bar, not a white wrapper.
    const band = [document.querySelector('header'), nav, ...top]
      .filter((el) => el && el.getClientRects().length && style(el).visibility !== 'hidden' && (style(el).position !== 'fixed' || el.tagName === 'HEADER'))
      .map((el) => style(el).backgroundColor)
      .find((c) => !clear(c) && c !== pageBackground && !c.match(/\d+/g).slice(0, 3).every((n) => n >= 240));
    return {
      background: bodyBackground,
      primary: band ?? style(h1)?.color,
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
