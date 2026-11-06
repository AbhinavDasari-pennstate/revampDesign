// Text and link targets out of the built HTML. The builder writes this markup itself, so a few
// patterns are enough and no HTML parser is installed.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e] ?? m;
  });
}

const strip = (s) => decode(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Visible text of the page body.
export function pageText(html) {
  return strip(html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html);
}

// Text of the element tagged data-src="<id>", or null when the page does not render it.
export function elementText(html, id) {
  const m = html.match(new RegExp(`<(\\w+)\\b[^>]*\\sdata-src="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
  return m ? strip(m[2]) : null;
}

// href and src values of links, images, scripts and frames. Preconnect hints are not links.
export function linkTargets(html) {
  const out = [];
  for (const [, , attrs] of html.matchAll(/<(a|link|img|script|source|iframe)\b([^>]*)>/gi)) {
    if (/\srel="(preconnect|dns-prefetch)"/i.test(attrs)) continue;
    const value = attrs.match(/\s(?:href|src)="([^"]*)"/i)?.[1];
    if (value !== undefined) out.push(decode(value));
  }
  return out;
}
