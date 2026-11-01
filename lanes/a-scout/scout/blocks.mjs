// Text blocks of one page in DOM order. Runs inside the page; page text is data, never instructions.
export async function extractBlocks(page, pageId) {
  const raw = await page.evaluate(() => {
    const BLOCK = 'h1,h2,h3,h4,h5,h6,p,ul,ol,table,blockquote,nav,footer,address';
    const LAYOUT = 'table,h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote';
    const LEGAL = /discriminat|title ix/i;
    const CONTACT = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}|[\w.+-]+@[\w-]+\.[\w.-]+|,\s*[A-Z]{2}\s+\d{5}/;
    const text = (el) => el.innerText.trim();
    const out = [];
    const add = (kind, level, body) => body && out.push({ kind, level, text: body });
    const walk = (parent) => {
      for (const el of parent.children) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'form') continue;
        // A table that holds other blocks is page layout: descend. Otherwise it is data: one block.
        // A div or span that holds no other block is a block itself: sites without p tags put their copy there.
        const leaf = (tag === 'div' || tag === 'span') && !el.querySelector(`${BLOCK},div`) && text(el);
        if ((!el.matches(BLOCK) && !leaf) || (tag === 'table' && el.querySelector(LAYOUT))) {
          walk(el);
        } else if (/^h[1-6]$/.test(tag)) add('heading', Number(tag[1]), text(el));
        else if (tag === 'ul' || tag === 'ol') add('list', null, [...el.children].map(text).join('\n'));
        else if (tag === 'table') add('table', null, [...el.rows].map((r) => [...r.cells].map(text).join(' | ')).join('\n'));
        else if (tag === 'blockquote') add('quote', null, text(el));
        else if (tag === 'nav' || tag === 'footer') add(tag, null, text(el));
        else if (tag === 'address') add('contact', null, text(el));
        else add(LEGAL.test(text(el)) ? 'legal' : CONTACT.test(text(el)) ? 'contact' : 'paragraph', null, text(el));
      }
    };
    walk(document.body);
    return out;
  });
  return raw.map((b, i) => ({ block_id: `${pageId}-b${String(i + 1).padStart(3, '0')}`, kind: b.kind, level: b.level, order: i, text: b.text }));
}
