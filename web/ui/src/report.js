// The run's report.md as a plain tree, for Report.jsx to draw with React text children. The report is built from a
// scraped site, so this reads only headings, paragraphs, lists and bold. Everything else (HTML, links, images, code)
// stays as the literal text it was, and no node ever carries a URL or an attribute.
//
// Block: {tag: 'h1'..'h6' | 'p', children: inline[]} or {tag: 'ul' | 'ol', children: [{tag: 'li', children: inline[]}]}.
// Inline: {tag: 'text' | 'strong', text}.

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/;
const NUMBERED = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
// Bold needs text that starts and ends with a non space and holds no marker character, so a stray ** stays text.
const BOLD = /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*|__([^_\s](?:[^_]*[^_\s])?)__/g;

function inline(text) {
  const nodes = [];
  let at = 0;
  for (const m of text.matchAll(BOLD)) {
    if (m.index > at) nodes.push({ tag: 'text', text: text.slice(at, m.index) });
    nodes.push({ tag: 'strong', text: m[1] ?? m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) nodes.push({ tag: 'text', text: text.slice(at) });
  return nodes;
}

export function parseReport(markdown) {
  if (typeof markdown !== 'string') return [];
  const blocks = [];
  let paragraph = null; // lines of the open paragraph
  let list = null; // {tag, items: [lines]} of the open list

  const close = () => {
    if (paragraph) blocks.push({ tag: 'p', children: inline(paragraph.join(' ')) });
    if (list) blocks.push({ tag: list.tag, children: list.items.map((item) => ({ tag: 'li', children: inline(item) })) });
    paragraph = null;
    list = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '' || RULE.test(line)) {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const text = heading[2].replace(/[ \t]+#+$/, '').trim();
      blocks.push({ tag: `h${heading[1].length}`, children: inline(text) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        close();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)[1].trim());
      continue;
    }
    if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    (paragraph ??= []).push(line.trim());
  }
  close();
  return blocks;
}
