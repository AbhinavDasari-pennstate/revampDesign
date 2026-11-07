// WCAG 2.1 contrast, computed by code (never by a model).
const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toHex = (parts) => `#${parts.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// Mix hex toward black (amount > 0) or white (amount < 0).
export function shade(hex, amount) {
  const target = amount > 0 ? 0 : 255;
  return toHex(rgb(hex).map((v) => v + (target - v) * Math.abs(amount)));
}

// Darken fg on a light bg (or lighten it on a dark bg) until it reaches min contrast.
export function fit(fg, bg, min = 4.5) {
  const dir = luminance(bg) > 0.18 ? 1 : -1;
  let out = fg;
  for (let i = 1; contrast(out, bg) < min && i <= 20; i++) out = shade(fg, dir * i * 0.05);
  return out;
}

// White or near-black text, whichever reads better on bg.
export const onColor = (bg) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111');
